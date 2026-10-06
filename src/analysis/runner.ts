import type { Config } from "../config.js";
import type { AuditLog } from "../observability/audit.js";
import type { Logger } from "../observability/logger.js";
import type { Metrics } from "../observability/metrics.js";
import { sanitizeAnalysis } from "../security/sanitize.js";
import { fetchAndResizeImage } from "../services/images.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { Design } from "../sources/types.js";
import type { Repository } from "../storage/repository.js";
import { AnalysisProviderError, type AnalysisProvider } from "./provider.js";
import { toDesignAnalysis } from "./schema.js";

export interface AnalysisReport {
  dryRun: boolean;
  considered: number;
  analyzed: number;
  failed: number;
  costUsd: number;
  spentTodayUsd: number;
  capUsd: number | undefined;
  /** Ids that would be (dry run) or were processed. */
  ids: string[];
  stoppedReason?: "disabled" | "budget" | "provider_error" | "limit";
}

export interface RunnerDeps {
  repo: Repository;
  registry: SourceRegistry;
  provider: AnalysisProvider | undefined;
  analysis: Config["analysis"];
  clock: () => Date;
  logger: Logger;
  metrics: Metrics;
  audit?: AuditLog;
  fetchImage?: typeof fetchAndResizeImage;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);
/** Rough input size for budgeting: prompt plus metadata plus one resized image. */
const WORST_CASE_INPUT_TOKENS = 3_500;

/**
 * The analysis job. It runs outside any tool call (CLI backfill or the background timer), only for
 * sources whose register grants canAnalyze, and never spends past the daily cap.
 */
export class AnalysisRunner {
  constructor(private readonly deps: RunnerDeps) {}

  private costOf(inTok: number, outTok: number): number {
    const a = this.deps.analysis;
    return (inTok * a.priceInPerMTok + outTok * a.priceOutPerMTok) / 1_000_000;
  }

  /** Most one call could cost: used to refuse a call that could push spending past the cap. */
  private worstCaseCost(): number {
    return this.costOf(WORST_CASE_INPUT_TOKENS, this.deps.provider?.maxOutputTokens ?? 4000);
  }

  candidates(limit: number): Design[] {
    const now = this.deps.clock();
    const sources = this.deps.registry
      .list()
      .filter((s) => s.capabilities.canAnalyze)
      .map((s) => s.adapter.id);
    const seen = new Set<string>();
    return this.deps.repo
      .listNeedingAnalysis({ sources, limit: limit * 2, now })
      .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
      .slice(0, limit);
  }

  async run(opts: { limit: number; dryRun?: boolean; signal?: AbortSignal }): Promise<AnalysisReport> {
    const { repo, analysis, provider, logger, metrics } = this.deps;
    const now = this.deps.clock();
    const today = day(now);
    const spentAtStart = repo.getAnalysisUsage(today).costUsd;
    const report: AnalysisReport = {
      dryRun: opts.dryRun === true,
      considered: 0,
      analyzed: 0,
      failed: 0,
      costUsd: 0,
      spentTodayUsd: spentAtStart,
      capUsd: analysis.dailyCostCapUsd,
      ids: [],
    };
    const items = this.candidates(opts.limit);
    report.considered = items.length;

    if (opts.dryRun) {
      report.ids = items.map((d) => d.id);
      return report;
    }
    if (!analysis.enabled || !provider || analysis.dailyCostCapUsd === undefined) {
      report.stoppedReason = "disabled";
      return report;
    }

    let spent = spentAtStart;
    for (const design of items) {
      if (opts.signal?.aborted) break;
      if (spent + this.worstCaseCost() > analysis.dailyCostCapUsd) {
        report.stoppedReason = "budget";
        break;
      }
      const source = this.deps.registry.get(design.source);
      if (!source?.capabilities.canAnalyze) continue; // the register may have changed since listing

      let image: { data: string; mediaType: "image/jpeg" } | undefined;
      if (design.imageUrl) {
        const fetched = await (this.deps.fetchImage ?? fetchAndResizeImage)(
          design.imageUrl,
          source.adapter.allowedHosts,
          opts.signal ?? new AbortController().signal,
        );
        if ("image" in fetched) image = { data: fetched.image.data, mediaType: fetched.image.mimeType };
      }

      try {
        const res = await provider.analyze({ design, image }, opts.signal);
        const cost = this.costOf(res.usage.inputTokens, res.usage.outputTokens);
        repo.addAnalysisUsage(today, {
          costUsd: cost,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
        });
        spent += cost;
        report.costUsd += cost;
        report.ids.push(design.id);

        const candidate = res.failure ? null : toDesignAnalysis(res.output, this.deps.clock());
        const clean = candidate
          ? sanitizeAnalysis(candidate, (e) =>
              this.deps.audit?.record("sanitizer_flag", null, {
                source: design.source,
                field: e.field,
                rule: e.rule,
              }),
            )
          : undefined;
        if (!clean) {
          report.failed += 1;
          metrics.inc("edison_analysis_total", { outcome: "rejected" });
          logger.warn(
            { id: design.id, failure: res.failure ?? "schema_or_safety" },
            "analysis output discarded",
          );
          repo.markAnalysisFailed(design.id, now);
          continue;
        }
        if (repo.setModelAnalysis(design.id, clean)) {
          report.analyzed += 1;
          metrics.inc("edison_analysis_total", { outcome: "stored" });
        }
      } catch (err) {
        if (err instanceof AnalysisProviderError && err.transient) {
          report.stoppedReason = "provider_error";
          logger.warn({ id: design.id }, "analysis provider unavailable: stopping this run");
          break;
        }
        report.failed += 1;
        repo.markAnalysisFailed(design.id, now);
        logger.warn({ id: design.id }, "analysis failed");
      }
    }
    report.spentTodayUsd = spent;
    if (!report.stoppedReason && report.considered >= opts.limit) report.stoppedReason = "limit";
    return report;
  }
}

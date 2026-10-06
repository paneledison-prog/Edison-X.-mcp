import { SourceError, TimeoutError } from "../errors.js";
import { sanitizeDesign } from "../security/sanitize.js";
import { sha256Hex } from "../security/crypto.js";
import type { LoadedSource } from "../sources/registry.js";
import type { Design, RawDesign, RequestContext, SourceQuery } from "../sources/types.js";
import { CATEGORY_SET } from "./taxonomy.js";
import type { ServiceDeps } from "./context.js";

export interface GatewaySearchResult {
  designs: Design[];
  totalEstimate?: number;
  cached: boolean;
}

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, parent: AbortSignal): Promise<T> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(ms)]);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new TimeoutError());
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work(signal).then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e instanceof Error ? e : new Error("source failed"));
      },
    );
  });
}

/**
 * The only path from an adapter to the rest of the server. It enforces the per-source timeout,
 * sanitizes every record, applies the register's caching limits, tracks health and metrics, and
 * turns any adapter failure into a SourceError with a short reason code.
 */
export class SourceGateway {
  constructor(private readonly deps: ServiceDeps) {}

  private reasonFor(err: unknown): string {
    if (err instanceof SourceError) return err.reason;
    if (err instanceof TimeoutError) return "timeout";
    return "error";
  }

  private sanitizeAll(src: LoadedSource, raws: RawDesign[], ctx: RequestContext): Design[] {
    const out: Design[] = [];
    for (const raw of raws) {
      const r = sanitizeDesign(raw, {
        adapter: { id: src.adapter.id, attributionTemplate: src.adapter.attributionTemplate, capabilities: src.capabilities, ownerContent: src.adapter.ownerContent },
        now: ctx.now,
        categories: CATEGORY_SET,
        onFlag: (e) => {
          this.deps.audit.record("sanitizer_flag", ctx.principal.id, { source: src.adapter.id, field: e.field, rule: e.rule });
        },
      });
      if (r.ok) out.push(r.design);
      else this.deps.metrics.inc("edison_sanitizer_rejects_total", { source: src.adapter.id, reason: r.reason });
    }
    return out;
  }

  private shouldStore(src: LoadedSource): boolean {
    return !src.adapter.ownerContent && src.capabilities.canStoreMetadata && src.capabilities.cacheTtlSeconds > 0;
  }

  private store(src: LoadedSource, designs: Design[], ctx: RequestContext): void {
    if (!this.shouldStore(src)) return;
    for (const d of designs) {
      this.deps.repo.upsertDesign(d, { ownerPrincipalId: src.capabilities.requiresUserAuth ? ctx.principal.id : null });
    }
  }

  async search(src: LoadedSource, q: SourceQuery, ctx: RequestContext): Promise<GatewaySearchResult> {
    const id = src.adapter.id;
    const { repo, metrics } = this.deps;
    const caching = this.shouldStore(src);
    const cacheKey = sha256Hex(
      JSON.stringify([id, src.capabilities.requiresUserAuth ? ctx.principal.id : "", q.text, q.platform, q.category, q.styles, q.colorHint, q.limit]),
    );
    if (caching) {
      const hit = repo.getSourceCache(cacheKey, ctx.now);
      if (hit) {
        const viewer = { principalId: ctx.principal.id, now: ctx.now };
        const designs = hit.designIds.map((d) => repo.getDesign(d, viewer)).filter((d): d is Design => d !== null);
        metrics.inc("edison_cache_requests_total", { source: id, result: "hit" });
        return { designs, totalEstimate: hit.totalEstimate ?? undefined, cached: true };
      }
      metrics.inc("edison_cache_requests_total", { source: id, result: "miss" });
    }

    const started = performance.now();
    try {
      const page = await withTimeout(
        (signal) => src.adapter.search(q, { ...ctx, signal }),
        this.deps.sourceTimeoutMs,
        ctx.signal,
      );
      const designs = this.sanitizeAll(src, page.designs, ctx);
      this.store(src, designs, ctx);
      if (caching) {
        repo.putSourceCache(
          cacheKey,
          id,
          ctx.principal.id,
          { designIds: designs.map((d) => d.id), totalEstimate: page.totalEstimate ?? null },
          new Date(ctx.now.getTime() + src.capabilities.cacheTtlSeconds * 1000),
        );
      }
      this.deps.registry.health.record(id, true);
      metrics.observe("edison_source_latency_ms", performance.now() - started, { source: id });
      return { designs, totalEstimate: page.totalEstimate, cached: false };
    } catch (err) {
      this.deps.registry.health.record(id, false);
      const reason = this.reasonFor(err);
      metrics.inc("edison_source_errors_total", { source: id, reason });
      if (reason === "rate_limited") metrics.inc("edison_rate_limit_hits_total", { scope: `source:${id}` });
      if (reason === "error") this.deps.logger.warn({ err, source: id }, "source search failed");
      throw new SourceError(id, reason);
    }
  }

  async getById(src: LoadedSource, sourceId: string, ctx: RequestContext): Promise<Design | null> {
    const id = src.adapter.id;
    try {
      const raw = await withTimeout((signal) => src.adapter.getById(sourceId, { ...ctx, signal }), this.deps.sourceTimeoutMs, ctx.signal);
      this.deps.registry.health.record(id, true);
      if (!raw) return null;
      const [design] = this.sanitizeAll(src, [{ ...raw, sourceId }], ctx);
      if (!design) return null;
      this.store(src, [design], ctx);
      return design;
    } catch (err) {
      this.deps.registry.health.record(id, false);
      const reason = this.reasonFor(err);
      this.deps.metrics.inc("edison_source_errors_total", { source: id, reason });
      if (reason === "error") this.deps.logger.warn({ err, source: id }, "source getById failed");
      throw new SourceError(id, reason);
    }
  }
}

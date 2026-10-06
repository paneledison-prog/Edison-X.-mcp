import type { App } from "../app.js";
import { ClaudeAnalysisProvider } from "./provider.js";
import { AnalysisRunner } from "./runner.js";

/** Build the runner for an app. The provider exists only when analysis is enabled and configured. */
export function createAnalysisRunner(app: App, provider = defaultProvider(app)): AnalysisRunner {
  return new AnalysisRunner({
    repo: app.repo,
    registry: app.registry,
    provider,
    analysis: app.config.analysis,
    clock: app.runDeps.clock,
    logger: app.logger,
    metrics: app.metrics,
    audit: app.audit,
  });
}

function defaultProvider(app: App): ClaudeAnalysisProvider | undefined {
  const a = app.config.analysis;
  return a.enabled && a.anthropicApiKey ? new ClaudeAnalysisProvider(a.model, a.anthropicApiKey) : undefined;
}

/**
 * Background job: when ANALYSIS_ENABLED, periodically analyse designs that lack analysis.
 * It never runs inside a tool call. Returns a stop function.
 */
export function startAnalysisJob(
  app: App,
  intervalMs = app.config.analysisIntervalMinutes * 60_000,
): () => void {
  if (!app.config.analysis.enabled) return () => undefined;
  const runner = createAnalysisRunner(app);
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    runner
      .run({ limit: 10 })
      .then((r) =>
        app.logger.info(
          { analyzed: r.analyzed, failed: r.failed, costUsd: r.costUsd, stopped: r.stoppedReason },
          "analysis job finished",
        ),
      )
      .catch((err: unknown) => app.logger.error({ err }, "analysis job crashed"))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

import type { AuditLog } from "../observability/audit.js";
import type { Logger } from "../observability/logger.js";
import type { Metrics } from "../observability/metrics.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { TextScorer } from "../storage/fts-scorer.js";
import type { Repository } from "../storage/repository.js";
import type { CursorCodec } from "./cursor.js";

/** Everything services need. Built once in `src/app.ts` and passed down; never imported globally. */
export interface ServiceDeps {
  repo: Repository;
  registry: SourceRegistry;
  scorer: TextScorer;
  cursors: CursorCodec;
  audit: AuditLog;
  metrics: Metrics;
  logger: Logger;
  clock: () => Date;
  sourceTimeoutMs: number;
}

import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";
import type { OpsRepository } from "../storage/repository.js";
import { redactValue } from "../security/redact.js";

export const AUDIT_EVENTS = [
  "key_created",
  "key_revoked",
  "auth_denied",
  "scope_denied",
  "rate_limited",
  "source_connected",
  "source_disconnected",
  "source_disabled",
  "library_submission",
  "sanitizer_flag",
  "design_removed",
  "source_purged",
  "collection_created",
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

/** Writes security-relevant events to the `audit_log` table (details redacted) and counts them. */
export class AuditLog {
  constructor(
    private readonly repo: OpsRepository,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  record(event: AuditEvent, principalId: string | null, details: Record<string, unknown> = {}): void {
    const safe = redactValue(details) as Record<string, unknown>;
    try {
      this.repo.appendAudit(event, principalId, safe, this.clock());
    } catch (err) {
      this.logger.error({ err, event }, "failed to write audit log");
    }
    this.metrics.inc("edison_audit_events_total", { event });
    this.logger.info({ audit: event, principalId, ...safe }, "audit");
  }
}

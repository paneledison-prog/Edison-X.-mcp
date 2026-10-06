import type { Logger } from "../observability/logger.js";
import type { AuditLog } from "../observability/audit.js";
import { CAPABILITY_FLAGS, type SourceAdapter, type SourceCapabilities } from "./types.js";
import { validateEntry, type RawEntry, type RegisterEntry } from "./register.js";

export interface LoadedSource {
  adapter: SourceAdapter;
  entry: RegisterEntry;
  /** What the adapter can do AND the register allows. Every layer uses these, never the adapter's own flags. */
  capabilities: SourceCapabilities;
}

export interface RefusedSource {
  id: string;
  reasons: string[];
}

export type Health = "ok" | "degraded" | "down";

/** Rolling record of recent outcomes per source, used for `list_sources` and ranking penalties. */
export class HealthTracker {
  private recent = new Map<string, boolean[]>();

  record(id: string, ok: boolean): void {
    const list = this.recent.get(id) ?? [];
    list.push(ok);
    if (list.length > 10) list.shift();
    this.recent.set(id, list);
  }

  health(id: string): Health {
    const list = this.recent.get(id) ?? [];
    if (list.length >= 3 && list.slice(-3).every((x) => !x)) return "down";
    if (list.length >= 4 && list.filter((x) => !x).length / list.length >= 0.3) return "degraded";
    return "ok";
  }
}

export class SourceRegistry {
  readonly health = new HealthTracker();

  constructor(
    private readonly loaded: Map<string, LoadedSource>,
    readonly refused: RefusedSource[],
  ) {}

  get(id: string): LoadedSource | undefined {
    return this.loaded.get(id);
  }

  list(): LoadedSource[] {
    return [...this.loaded.values()].sort((a, b) => a.adapter.id.localeCompare(b.adapter.id));
  }

  ids(): string[] {
    return this.list().map((s) => s.adapter.id);
  }

  /** Every host any loaded adapter may contact. */
  allowedHosts(): string[] {
    return [...new Set(this.list().flatMap((s) => [...s.adapter.allowedHosts]))];
  }
}

export interface LoadOptions {
  enabledIds: readonly string[];
  adapters: readonly SourceAdapter[];
  register: Map<string, RawEntry>;
  now: Date;
  logger: Logger;
  audit?: AuditLog;
}

/** A capability is effective only when the adapter implements it and the register grants it. */
export function effectiveCapabilities(adapter: SourceAdapter, entry: RegisterEntry): SourceCapabilities {
  const out: SourceCapabilities = { ...adapter.capabilities };
  for (const flag of CAPABILITY_FLAGS) out[flag] = adapter.capabilities[flag] && entry.capabilities[flag];
  out.cacheTtlSeconds = Math.min(adapter.capabilities.cacheTtlSeconds, entry.capabilities.cacheTtlSeconds);
  return out;
}

/**
 * Fail closed: an enabled source loads only if its adapter is not BLOCKED, its register entry is
 * complete and current, and the owner approved it. Capabilities are narrowed to what the register
 * grants. Anything else is refused and the reason is logged and audited.
 */
export function loadSources(opts: LoadOptions): SourceRegistry {
  const loaded = new Map<string, LoadedSource>();
  const refused: RefusedSource[] = [];
  const byId = new Map(opts.adapters.map((a) => [a.id, a]));

  const refuse = (id: string, reasons: string[]): void => {
    refused.push({ id, reasons });
    opts.logger.error({ source: id, reasons }, "source refused: not loading");
    opts.audit?.record("source_disabled", null, { source: id, reasons });
  };

  for (const id of opts.enabledIds) {
    const adapter = byId.get(id);
    if (!adapter) {
      refuse(id, ["no adapter exists for this source id"]);
      continue;
    }
    if (adapter.status === "BLOCKED") {
      refuse(id, ["adapter status is BLOCKED"]);
      continue;
    }
    const validation = validateEntry(id, opts.register.get(id), opts.now);
    if (!validation.ok) {
      refuse(id, validation.problems);
      continue;
    }
    const { entry } = validation;
    const problems: string[] = [];
    if (entry.status === "BLOCKED") problems.push("register status is BLOCKED");
    if (entry.status !== adapter.status) problems.push(`register status ${entry.status} does not match adapter status ${adapter.status}`);
    if (problems.length > 0) {
      refuse(id, problems);
      continue;
    }
    const capabilities = effectiveCapabilities(adapter, entry);
    const narrowed = CAPABILITY_FLAGS.filter((f) => adapter.capabilities[f] && !capabilities[f]);
    if (narrowed.length > 0) opts.logger.info({ source: id, narrowed }, "capabilities narrowed to the register's grants");
    loaded.set(id, { adapter, entry, capabilities });
  }
  return new SourceRegistry(loaded, refused);
}

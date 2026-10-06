import { SourceError, ValidationError } from "../errors.js";
import type { Design, Platform, RequestContext, SourceQuery } from "../sources/types.js";
import type { LoadedSource } from "../sources/registry.js";
import { CursorCodec } from "./cursor.js";
import type { ServiceDeps } from "./context.js";
import { SourceGateway } from "./gateway.js";
import { dedupeBySourceUrl, rank, type Ranked } from "./ranking.js";

export interface SearchInput {
  query: string;
  platform: Platform | "any";
  category?: string;
  style: string[];
  colorHint?: string;
  sources?: string[];
  limit: number;
  cursor?: string;
}

export interface SearchOutcome {
  page: Array<Ranked & { canHotlink: boolean }>;
  nextCursor?: string;
  totalEstimate: number;
  sourcesQueried: string[];
  sourcesSkipped: Array<{ source: string; reason: string }>;
  /** The full ranked candidate list; used by the brief tool. */
  allRanked: Ranked[];
}

const CANDIDATES_PER_SOURCE = 60;
const MAX_CANDIDATES = 100;

export class SearchService {
  readonly gateway: SourceGateway;

  constructor(private readonly deps: ServiceDeps) {
    this.gateway = new SourceGateway(deps);
  }

  /** Query enabled sources in parallel (one failing never fails the call), merge, dedupe, rank, paginate. */
  async search(input: SearchInput, ctx: RequestContext): Promise<SearchOutcome> {
    const { registry, scorer, cursors } = this.deps;
    const skipped: SearchOutcome["sourcesSkipped"] = [];

    let targets: LoadedSource[];
    if (input.sources && input.sources.length > 0) {
      targets = [];
      for (const id of [...new Set(input.sources)]) {
        const s = registry.get(id);
        if (s) targets.push(s);
        else skipped.push({ source: id, reason: "unknown or disabled source" });
      }
    } else {
      targets = registry.list();
    }

    const sq: SourceQuery = {
      text: input.query,
      platform: input.platform,
      category: input.category,
      styles: input.style,
      colorHint: input.colorHint,
      limit: CANDIDATES_PER_SOURCE,
    };

    const queried: string[] = [];
    const settled = await Promise.all(
      targets.map(async (src): Promise<Design[]> => {
        const id = src.adapter.id;
        if (!src.capabilities.canSearch) {
          skipped.push({ source: id, reason: "search not supported" });
          return [];
        }
        try {
          if (src.capabilities.requiresUserAuth) {
            const status = await src.adapter.connectionStatus?.(ctx);
            if (!status?.connected) {
              skipped.push({ source: id, reason: "not connected" });
              return [];
            }
          }
          const res = await this.gateway.search(src, sq, ctx);
          queried.push(id);
          return res.designs;
        } catch (err) {
          skipped.push({
            source: id,
            reason: err instanceof SourceError ? err.reason.replace(/_/g, " ") : "error",
          });
          return [];
        }
      }),
    );

    const hotlink = new Map(registry.list().map((s) => [s.adapter.id, s.capabilities.canHotlink]));
    const candidates = settled.flat();
    const terms = [input.query, ...input.style, ...(input.category ? [input.category] : [])];
    const text = scorer.score(terms, candidates);
    const deduped = dedupeBySourceUrl(
      candidates.map((design) => ({
        design,
        text: text.get(design.id) ?? 0,
        sourceHealth: registry.health.health(design.source),
      })),
    );
    const allRanked = rank(deduped, {
      platform: input.platform,
      category: input.category,
      styles: input.style,
      colorHint: input.colorHint,
      now: ctx.now,
    }).slice(0, MAX_CANDIDATES);

    const qh = CursorCodec.queryHash([
      input.query,
      input.platform,
      input.category,
      input.style,
      input.colorHint,
      [...(input.sources ?? [])].sort(),
      input.limit,
    ]);
    const offset = input.cursor
      ? cursors.decode(input.cursor, qh, ctx.principal.id, ctx.now.getTime()).offset
      : 0;
    if (offset > allRanked.length)
      throw new ValidationError("The cursor points past the end of the results.");
    const slice = allRanked.slice(offset, offset + input.limit);
    const nextOffset = offset + input.limit;
    return {
      page: slice.map((r) => ({ ...r, canHotlink: hotlink.get(r.design.source) ?? false })),
      nextCursor:
        nextOffset < allRanked.length
          ? cursors.encode(nextOffset, qh, ctx.principal.id, ctx.now.getTime())
          : undefined,
      totalEstimate: allRanked.length,
      sourcesQueried: queried.sort(),
      sourcesSkipped: skipped.sort((a, b) => a.source.localeCompare(b.source)),
      allRanked,
    };
  }
}

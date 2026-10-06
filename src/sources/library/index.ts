import type { DesignRepository } from "../../storage/repository.js";
import type {
  Design,
  RawDesign,
  RequestContext,
  SourceAdapter,
  SourceCapabilities,
  SourcePage,
  SourceQuery,
} from "../types.js";

export const LIBRARY_ID = "library";

/** Serve a stored library design as an adapter record (the service sanitizes it again before returning). */
export function designToRaw(d: Design): RawDesign {
  return {
    sourceId: d.sourceId,
    title: d.title,
    sourceUrl: d.sourceUrl,
    imageUrl: d.imageUrl,
    thumbnailUrl: d.thumbnailUrl,
    creator: d.creator ?? null,
    license: d.license,
    attribution: d.attribution,
    platform: d.platform,
    category: d.category,
    tags: d.tags,
    palette: d.palette,
    summary: d.summary,
    analysis: d.analysis,
  };
}

/** The owner's own curated designs. Reads from the local database only; never contacts the network. */
export class LibraryAdapter implements SourceAdapter {
  readonly id = LIBRARY_ID;
  readonly displayName = "Edison X library";
  readonly status = "OWN_LIBRARY" as const;
  readonly attributionTemplate = "Via Edison X library - {creator}";
  readonly ownerContent = true;
  readonly capabilities: SourceCapabilities = {
    canSearch: true,
    canGetById: true,
    canStoreMetadata: true,
    canAnalyze: true,
    canHotlink: true,
    canProxyImage: true,
    cacheTtlSeconds: 0,
    requiresUserAuth: false,
  };

  /** @param imageHosts hosts the owner's own images live on; empty means no image fetching. */
  constructor(
    private readonly repo: Pick<DesignRepository, "searchByTerms" | "getDesign" | "countDesigns"> & {
      ping(): boolean;
    },
    readonly allowedHosts: readonly string[] = [],
  ) {}

  search(q: SourceQuery, ctx: RequestContext): Promise<SourcePage> {
    const terms = [q.text, ...q.styles, ...(q.category ? [q.category] : [])];
    const hits = this.repo.searchByTerms(terms, {
      sources: [LIBRARY_ID],
      limit: q.limit,
      viewer: { principalId: ctx.principal.id, now: ctx.now },
    });
    return Promise.resolve({ designs: hits.map((h) => designToRaw(h.design)), totalEstimate: hits.length });
  }

  getById(sourceId: string, ctx: RequestContext): Promise<RawDesign | null> {
    const d = this.repo.getDesign(`${LIBRARY_ID}:${sourceId}`, {
      principalId: ctx.principal.id,
      now: ctx.now,
    });
    return Promise.resolve(d ? designToRaw(d) : null);
  }

  healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return Promise.resolve(this.repo.ping() ? { ok: true } : { ok: false, detail: "database unreachable" });
  }
}

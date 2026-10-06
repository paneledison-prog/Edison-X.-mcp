import { SourceError } from "../../errors.js";
import type { PinterestConnections } from "../../auth/oauth-pinterest.js";
import { PinterestClient, PINTEREST_API_HOST, PINTEREST_IMAGE_HOST, type Pin } from "./client.js";
import type {
  ConnectionStatus,
  RawDesign,
  RequestContext,
  SourceAdapter,
  SourceCapabilities,
  SourcePage,
  SourceQuery,
} from "../types.js";

export const PINTEREST_ID = "pinterest";
const MAX_PAGES = 4;

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);

/** Map an API pin to an untrusted raw record; the sanitizer decides what survives. */
export function pinToRaw(pin: Pin): RawDesign {
  const images = pin.media?.images ?? {};
  const big = images["600x"] ?? images["1200x"] ?? images["originals"] ?? Object.values(images)[0];
  const small = images["400x300"] ?? images["236x"] ?? images["150x150"] ?? big;
  const username = pin.board_owner?.username ?? undefined;
  return {
    sourceId: pin.id,
    title: pin.title || pin.alt_text || pin.description?.slice(0, 120) || "Pinterest pin",
    sourceUrl: `https://www.pinterest.com/pin/${encodeURIComponent(pin.id)}/`,
    imageUrl: big?.url,
    thumbnailUrl: small?.url,
    creator: username
      ? { name: username, url: `https://www.pinterest.com/${encodeURIComponent(username)}/` }
      : null,
    license: "source-terms",
    summary: pin.description ?? pin.alt_text ?? undefined,
    tags: ["pinterest"],
    platform: "unknown",
  };
}

/**
 * Pinterest through the official API v5 with the connecting user's own authorization. It reads only
 * that user's own pins. If the API returns less than a search promises, we return less: never scrape.
 */
export class PinterestAdapter implements SourceAdapter {
  readonly id = PINTEREST_ID;
  readonly displayName = "Pinterest (your own pins)";
  readonly status = "USER_OAUTH" as const;
  readonly attributionTemplate = "Via Pinterest - {creator}";
  readonly allowedHosts = [PINTEREST_API_HOST, PINTEREST_IMAGE_HOST];
  /** The maximum this adapter can do. The register entry narrows it; the most conservative grant is the default. */
  readonly capabilities: SourceCapabilities = {
    canSearch: true,
    canGetById: true,
    canStoreMetadata: true,
    canAnalyze: false,
    canHotlink: true,
    canProxyImage: false,
    cacheTtlSeconds: 3600,
    requiresUserAuth: true,
  };

  constructor(
    private readonly connections: PinterestConnections,
    private readonly client: PinterestClient,
  ) {}

  /** Run an API call with the user's token; on 401 refresh once and retry, then treat as disconnected. */
  private async withToken<T>(ctx: RequestContext, run: (token: string) => Promise<T>): Promise<T> {
    const token = await this.connections.getAccessToken(ctx.principal.id, ctx.signal);
    try {
      return await run(token);
    } catch (err) {
      if (err instanceof SourceError && err.reason === "unauthorized") {
        const fresh = await this.connections.refresh(ctx.principal.id, ctx.signal);
        try {
          return await run(fresh);
        } catch (err2) {
          if (err2 instanceof SourceError && err2.reason === "unauthorized") {
            await this.connections.disconnect(ctx.principal.id);
            throw new SourceError(PINTEREST_ID, "not_connected");
          }
          throw err2;
        }
      }
      throw err;
    }
  }

  async search(q: SourceQuery, ctx: RequestContext): Promise<SourcePage> {
    const wanted = tokens([q.text, ...q.styles, q.category ?? ""].join(" "));
    const matched: Pin[] = [];
    await this.withToken(ctx, async (token) => {
      let bookmark: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await this.client.listPins(token, bookmark, ctx.signal);
        for (const pin of res.pins) {
          const hay = new Set(tokens([pin.title, pin.description, pin.alt_text].filter(Boolean).join(" ")));
          if (wanted.length === 0 || wanted.some((w) => hay.has(w))) matched.push(pin);
        }
        bookmark = res.bookmark;
        if (!bookmark || matched.length >= q.limit) break;
      }
    });
    return { designs: matched.slice(0, q.limit).map(pinToRaw), totalEstimate: matched.length };
  }

  async getById(sourceId: string, ctx: RequestContext): Promise<RawDesign | null> {
    const pin = await this.withToken(ctx, (token) => this.client.getPin(token, sourceId, ctx.signal));
    return pin ? pinToRaw(pin) : null;
  }

  connectionStatus(ctx: RequestContext): Promise<ConnectionStatus> {
    return Promise.resolve({ connected: this.connections.isConnected(ctx.principal.id) });
  }

  healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return Promise.resolve(
      this.client.cooldownSeconds() > 0 ? { ok: false, detail: "rate limited" } : { ok: true },
    );
  }
}

import { z } from "zod";
import { SourceError } from "../../errors.js";
import { TokenBucket } from "../../security/ratelimit.js";
import { safeFetch, SsrfError, type RawResponse, type SafeFetchOptions } from "../../security/safe-fetch.js";

/** Official Pinterest REST API v5 client. Nothing else is ever contacted. */
export const PINTEREST_API_HOST = "api.pinterest.com";
export const PINTEREST_IMAGE_HOST = "i.pinimg.com";
export const PINTEREST_API_BASE = `https://${PINTEREST_API_HOST}/v5`;

export type PinterestFetch = (url: string, opts: SafeFetchOptions) => Promise<RawResponse>;

const nullableString = z.string().nullish();

const ImageSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export const PinSchema = z.object({
  id: z.string(),
  title: nullableString,
  description: nullableString,
  alt_text: nullableString,
  link: nullableString,
  board_id: nullableString,
  board_owner: z.object({ username: z.string().nullish() }).nullish(),
  media: z
    .object({
      media_type: z.string().nullish(),
      images: z.record(z.string(), ImageSchema).nullish(),
    })
    .nullish(),
});
export type Pin = z.infer<typeof PinSchema>;

const PinPageSchema = z.object({ items: z.array(z.unknown()), bookmark: z.string().nullish() });

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().optional(),
  expires_in: z.number().positive().optional(),
  refresh_token_expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export interface PinterestClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetcher?: PinterestFetch;
  now?: () => number;
  /** Outbound limit in front of every API call. Tune it to the access tier recorded in docs/SOURCES.md. */
  rateLimit?: { burst: number; perSecond: number };
}

/** A 429 puts the client into a cooldown, so callers never retry in a tight loop. */
export class PinterestClient {
  private blockedUntil = 0;
  private readonly fetcher: PinterestFetch;
  private readonly now: () => number;
  private readonly bucket: TokenBucket;

  constructor(private readonly opts: PinterestClientOptions) {
    this.fetcher = opts.fetcher ?? safeFetch;
    this.now = opts.now ?? Date.now;
    const rl = opts.rateLimit ?? { burst: 20, perSecond: 5 };
    this.bucket = new TokenBucket(rl.burst, rl.perSecond, this.now);
  }

  /** Seconds left in the current rate-limit cooldown, or 0. */
  cooldownSeconds(): number {
    return Math.max(0, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }

  private async call(
    method: "GET" | "POST",
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
    body?: string,
  ): Promise<unknown> {
    if (this.cooldownSeconds() > 0) throw new SourceError("pinterest", "rate_limited");
    // Token bucket in front of the API: a burst beyond our own budget never reaches Pinterest.
    if (!this.bucket.take().ok) throw new SourceError("pinterest", "rate_limited");
    let res: RawResponse;
    try {
      res = await this.fetcher(url, {
        allowedHosts: [PINTEREST_API_HOST],
        method,
        headers,
        body,
        maxBytes: 1_000_000,
        timeoutMs: 5_000,
        signal,
      });
    } catch (err) {
      throw new SourceError("pinterest", err instanceof SsrfError ? "blocked" : "unavailable");
    }
    if (res.status === 429) {
      const retry = Number(res.headers["retry-after"]);
      this.blockedUntil =
        this.now() + (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : 60) * 1000;
      throw new SourceError("pinterest", "rate_limited");
    }
    if (res.status === 401 || res.status === 403) throw new SourceError("pinterest", "unauthorized");
    if (res.status === 404) throw new SourceError("pinterest", "not_found");
    if (res.status >= 500) throw new SourceError("pinterest", "unavailable");
    if (res.status < 200 || res.status >= 300) throw new SourceError("pinterest", "error");
    try {
      return JSON.parse(res.body.toString("utf8")) as unknown;
    } catch {
      throw new SourceError("pinterest", "bad_response");
    }
  }

  private basic(): string {
    return `Basic ${Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64")}`;
  }

  private async token(form: Record<string, string>, signal?: AbortSignal): Promise<TokenResponse> {
    const json = await this.call(
      "POST",
      `${PINTEREST_API_BASE}/oauth/token`,
      {
        Authorization: this.basic(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      signal,
      new URLSearchParams(form).toString(),
    );
    const parsed = TokenResponseSchema.safeParse(json);
    if (!parsed.success) throw new SourceError("pinterest", "bad_response");
    return parsed.data;
  }

  exchangeCode(code: string, signal?: AbortSignal): Promise<TokenResponse> {
    return this.token(
      { grant_type: "authorization_code", code, redirect_uri: this.opts.redirectUri },
      signal,
    );
  }

  refresh(refreshToken: string, signal?: AbortSignal): Promise<TokenResponse> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken }, signal);
  }

  /** One page of the connecting user's own pins. */
  async listPins(
    accessToken: string,
    bookmark: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ pins: Pin[]; bookmark?: string }> {
    const qs = new URLSearchParams({ page_size: "25", ...(bookmark ? { bookmark } : {}) });
    const json = await this.call(
      "GET",
      `${PINTEREST_API_BASE}/pins?${qs.toString()}`,
      { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal,
    );
    const page = PinPageSchema.safeParse(json);
    if (!page.success) throw new SourceError("pinterest", "bad_response");
    // Drop items that do not validate rather than failing the whole page.
    const pins = page.data.items.flatMap((i) => {
      const p = PinSchema.safeParse(i);
      return p.success ? [p.data] : [];
    });
    return { pins, bookmark: page.data.bookmark ?? undefined };
  }

  async getPin(accessToken: string, pinId: string, signal?: AbortSignal): Promise<Pin | null> {
    try {
      const json = await this.call(
        "GET",
        `${PINTEREST_API_BASE}/pins/${encodeURIComponent(pinId)}`,
        { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal,
      );
      const p = PinSchema.safeParse(json);
      if (!p.success) throw new SourceError("pinterest", "bad_response");
      return p.data;
    } catch (err) {
      if (err instanceof SourceError && err.reason === "not_found") return null;
      throw err;
    }
  }
}

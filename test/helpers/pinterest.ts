import { readFileSync } from "node:fs";
import type { RawResponse, SafeFetchOptions } from "../../src/security/safe-fetch.js";
import type { PinterestFetch } from "../../src/sources/pinterest/client.js";
import { entryMarkdown } from "./fixtures.js";

export const fixture = (name: string): string => readFileSync(`test/fixtures/pinterest/${name}`, "utf8");

export const PINTEREST_REGISTER = (overrides: Record<string, string | null> = {}): string =>
  entryMarkdown("pinterest", {
    Status: "USER_OAUTH",
    Capabilities:
      "canSearch=true, canGetById=true, canStoreMetadata=true, canAnalyze=false, canHotlink=true, canProxyImage=false, cacheTtlSeconds=3600",
    ...overrides,
  });

export const PINTEREST_ENV = {
  ENABLED_SOURCES: "library,pinterest",
  PUBLIC_BASE_URL: "https://edison.test",
  PINTEREST_CLIENT_ID: "client-id-123",
  PINTEREST_CLIENT_SECRET: "client-secret-planted-xyz",
  PINTEREST_REDIRECT_URI: "https://edison.test/connect/pinterest/callback",
};

export interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  allowedHosts: readonly string[];
}

const json = (body: string | object, status = 200, headers: Record<string, string> = {}): RawResponse => ({
  status,
  headers,
  body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
});

/** A scripted stand-in for api.pinterest.com. Records every call so tests can assert on them. */
export class FakePinterest {
  calls: FakeCall[] = [];
  tokenResponses = [fixture("token.json"), fixture("token-refreshed.json")];
  /** Override the next response for a matching URL fragment. */
  forced: Array<{ match: string; res: RawResponse }> = [];
  validAccess = new Set(["pina_ACCESS_TOKEN_ONE_planted", "pina_ACCESS_TOKEN_TWO_planted"]);

  fetcher: PinterestFetch = (url, opts: SafeFetchOptions) => {
    const headers = opts.headers ?? {};
    const body = typeof opts.body === "string" ? opts.body : opts.body?.toString();
    this.calls.push({ method: opts.method ?? "GET", url, headers, body, allowedHosts: opts.allowedHosts });
    const forcedIdx = this.forced.findIndex((f) => url.includes(f.match));
    if (forcedIdx !== -1)
      return Promise.resolve((this.forced.splice(forcedIdx, 1)[0] as { res: RawResponse }).res);
    if (url.endsWith("/v5/oauth/token")) {
      const idx = Math.min(
        this.calls.filter((c) => c.url.endsWith("/oauth/token")).length - 1,
        this.tokenResponses.length - 1,
      );
      return Promise.resolve(json(this.tokenResponses[idx] as string));
    }
    const auth = /^Bearer (.+)$/.exec(headers["Authorization"] ?? "")?.[1];
    if (!auth || !this.validAccess.has(auth))
      return Promise.resolve(json({ code: 2, message: "Authentication failed." }, 401));
    if (url.includes("/v5/pins?"))
      return Promise.resolve(
        json(url.includes("bookmark=bm2") ? fixture("pins-page2.json") : fixture("pins-page1.json")),
      );
    const pin = /\/v5\/pins\/([^/?]+)$/.exec(url)?.[1];
    if (pin === "1001") return Promise.resolve(json(fixture("pin-1001.json")));
    if (pin) return Promise.resolve(json({ code: 404, message: "Pin not found." }, 404));
    return Promise.resolve(json({}, 404));
  };

  count(fragment: string): number {
    return this.calls.filter((c) => c.url.includes(fragment)).length;
  }
}

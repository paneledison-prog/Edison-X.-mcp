import { lookup as dnsLookup } from "node:dns";
import type { LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { checkUrl, isPrivateAddress } from "./ssrf.js";

/**
 * The only way the server fetches a URL. Every hop is checked statically, the connection uses a
 * lookup that validates the resolved address at connect time (no DNS-rebinding window), redirects
 * are re-checked and capped, and size and time are bounded.
 */

export class SsrfError extends Error {
  constructor(readonly reason: string) {
    super(`blocked outbound request: ${reason}`);
    this.name = "SsrfError";
  }
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export type LookupFn = (
  hostname: string,
  options: { all?: boolean; family?: number; hints?: number },
  cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void;

export type Transport = (
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: Buffer; timeoutMs: number; maxBytes: number; signal?: AbortSignal },
  lookup: LookupFn,
) => Promise<RawResponse>;

export interface SafeFetchOptions {
  allowedHosts: readonly string[];
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: Buffer | string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  /** Test seams. */
  transport?: Transport;
  lookup?: LookupFn;
}

/** A DNS lookup that refuses private, loopback, link-local and metadata addresses. */
export function createGuardedLookup(base: LookupFn = dnsLookup): LookupFn {
  return (hostname, options, cb) => {
    base(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, "", 0);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
      if (list.length === 0) return cb(new SsrfError("dns_empty"), "", 0);
      for (const a of list) {
        if (isPrivateAddress(a.address)) {
          return cb(new SsrfError("private_address"), "", 0);
        }
      }
      if (options.all) return cb(null, list);
      const first = list[0] as LookupAddress;
      return cb(null, first.address, first.family);
    });
  };
}

const nodeTransport: Transport = (url, init, lookup) =>
  new Promise<RawResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: init.method,
        headers: init.headers,
        lookup: lookup as never,
        timeout: init.timeoutMs,
        signal: init.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > init.maxBytes) {
            req.destroy(new SsrfError("response_too_large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new SsrfError("timeout")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });

function header(h: RawResponse["headers"], name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Fetch a URL under the SSRF policy. Throws SsrfError for any policy violation. */
export async function safeFetch(urlInput: string, opts: SafeFetchOptions): Promise<RawResponse> {
  const maxRedirects = Math.min(opts.maxRedirects ?? 3, 3);
  const maxBytes = opts.maxBytes ?? 5_000_000;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const transport = opts.transport ?? nodeTransport;
  const lookup = createGuardedLookup(opts.lookup);
  let current = urlInput;
  let method = opts.method ?? "GET";
  let body = typeof opts.body === "string" ? Buffer.from(opts.body) : opts.body;
  const headers = { ...(opts.headers ?? {}) };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = checkUrl(current, { allowedHosts: opts.allowedHosts });
    if (!checked.ok) throw new SsrfError(checked.reason);
    const res = await transport(checked.url, { method, headers: { ...headers }, body, timeoutMs, maxBytes, signal: opts.signal }, lookup);
    if (res.status >= 300 && res.status < 400 && header(res.headers, "location")) {
      if (hop === maxRedirects) throw new SsrfError("too_many_redirects");
      current = new URL(header(res.headers, "location") as string, checked.url).toString();
      // 303 (and 301/302 for POST) become GET without a body; never forward credentials across hosts.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      if (new URL(current).hostname !== checked.url.hostname) {
        delete headers["Authorization"];
        delete headers["authorization"];
      }
      continue;
    }
    return res;
  }
  throw new SsrfError("too_many_redirects");
}

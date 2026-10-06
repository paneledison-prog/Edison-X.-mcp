import { describe, expect, it } from "vitest";
import type { LookupAddress } from "node:dns";
import {
  safeFetch,
  SsrfError,
  createGuardedLookup,
  type LookupFn,
  type RawResponse,
  type Transport,
} from "../../src/security/safe-fetch.js";
import { checkUrl, isBlockedHostname, isPrivateAddress } from "../../src/security/ssrf.js";

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "127.0.0.1",
    "127.8.8.8",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.5",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.1.2.3",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "not-an-ip",
    "",
  ])("treats %j as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1",
    "100.63.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8",
  ])("treats %j as public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("checkUrl", () => {
  it.each([
    ["http://example.com/", "not_https"],
    ["https://localhost/", "blocked_host"],
    ["https://foo.localhost/", "blocked_host"],
    ["https://127.0.0.1/", "ip_literal"],
    ["https://169.254.169.254/latest", "ip_literal"],
    ["https://10.0.0.5/", "ip_literal"],
    ["https://[::1]/", "ip_literal"],
    ["https://[fd00:ec2::254]/", "ip_literal"],
    ["https://metadata.google.internal/", "blocked_host"],
    ["https://db.internal/", "blocked_host"],
    ["https://u:p@example.com/", "credentials"],
    ["https://example.com:8443/", "bad_port"],
    ["https://example.com@evil.com/", "credentials"],
    ["file:///etc/passwd", "not_https"],
    ["::::", "invalid_url"],
  ])("rejects %s (%s)", (url, reason) => {
    expect(checkUrl(url)).toEqual({ ok: false, reason });
  });

  it("enforces the host allowlist, including subdomains but not look-alikes", () => {
    const allowed = ["api.example.com"];
    expect(checkUrl("https://api.example.com/x", { allowedHosts: allowed }).ok).toBe(true);
    expect(checkUrl("https://v2.api.example.com/x", { allowedHosts: allowed }).ok).toBe(true);
    expect(checkUrl("https://evilapi.example.com.attacker.net/x", { allowedHosts: allowed })).toEqual({
      ok: false,
      reason: "host_not_allowed",
    });
    expect(checkUrl("https://notapi.example.com/x", { allowedHosts: allowed })).toEqual({
      ok: false,
      reason: "host_not_allowed",
    });
  });

  it("isBlockedHostname blocks single-label and internal suffixes", () => {
    for (const h of ["intranet", "box.lan", "x.corp", "a.home"]) expect(isBlockedHostname(h)).toBe(true);
    expect(isBlockedHostname("example.com")).toBe(false);
  });
});

const lookupTo =
  (table: Record<string, string[]>): LookupFn =>
  (host, _opts, cb) => {
    const addrs = (table[host] ?? []).map((address): LookupAddress => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    if (addrs.length === 0) return cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), "", 0);
    cb(null, addrs);
  };

/** A transport that behaves like the real one: it must resolve the host through the supplied lookup first. */
function fakeTransport(
  routes: Record<string, RawResponse | ((u: URL) => RawResponse)>,
  calls: string[] = [],
): Transport {
  return (url, _init, lookup) =>
    new Promise<RawResponse>((resolve, reject) => {
      lookup(url.hostname, {}, (err) => {
        if (err) return reject(err);
        calls.push(url.toString());
        const r = routes[url.toString()];
        if (!r) return reject(new Error("no route"));
        resolve(typeof r === "function" ? r(url) : r);
      });
    });
}

const ok = (body = "ok"): RawResponse => ({
  status: 200,
  headers: { "content-type": "text/plain" },
  body: Buffer.from(body),
});
const redirect = (to: string): RawResponse => ({
  status: 302,
  headers: { location: to },
  body: Buffer.alloc(0),
});

describe("safeFetch", () => {
  const allowedHosts = ["api.example.com", "evil.example.net"];
  const lookup = lookupTo({
    "api.example.com": ["93.184.216.34"],
    "evil.example.net": ["10.0.0.7"],
    "rebind.example.com": ["127.0.0.1", "93.184.216.34"],
  });

  it("fetches an allowed public host", async () => {
    const calls: string[] = [];
    const res = await safeFetch("https://api.example.com/a", {
      allowedHosts,
      lookup,
      transport: fakeTransport({ "https://api.example.com/a": ok() }, calls),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["https://api.example.com/a"]);
  });

  it.each([
    "http://api.example.com/a",
    "https://127.0.0.1/a",
    "https://localhost/a",
    "https://169.254.169.254/a",
    "https://api.example.com:9999/a",
    "https://other.example.org/a",
  ])("rejects %s before any connection", async (url) => {
    const calls: string[] = [];
    await expect(
      safeFetch(url, { allowedHosts, lookup, transport: fakeTransport({}, calls) }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("rejects a DNS name that resolves to a private address", async () => {
    const calls: string[] = [];
    await expect(
      safeFetch("https://evil.example.net/a", {
        allowedHosts,
        lookup,
        transport: fakeTransport({ "https://evil.example.net/a": ok() }, calls),
      }),
    ).rejects.toThrow(/private_address/);
    expect(calls).toEqual([]);
  });

  it("rejects a name with any private address among several (rebinding mix)", async () => {
    await expect(
      safeFetch("https://rebind.example.com/a", {
        allowedHosts: ["rebind.example.com"],
        lookup,
        transport: fakeTransport({}),
      }),
    ).rejects.toThrow(/private_address/);
  });

  it.each([
    ["to http", "http://api.example.com/b"],
    ["to a private IP literal", "https://10.0.0.1/b"],
    ["to the metadata address", "https://169.254.169.254/latest/meta-data"],
    ["to a host that resolves privately", "https://evil.example.net/b"],
    ["to a host that is not allowed", "https://elsewhere.example.org/b"],
  ])("re-checks redirects: %s", async (_name, target) => {
    const calls: string[] = [];
    const transport = fakeTransport(
      { "https://api.example.com/a": redirect(target), [target]: ok("secret") },
      calls,
    );
    await expect(
      safeFetch("https://api.example.com/a", { allowedHosts, lookup, transport }),
    ).rejects.toBeInstanceOf(Error);
    expect(calls).toEqual(["https://api.example.com/a"]);
  });

  it("follows a safe redirect, drops Authorization across hosts, and caps redirects at 3", async () => {
    const seen: Array<Record<string, string>> = [];
    const transport: Transport = (url, init, lk) =>
      new Promise((resolve, reject) => {
        lk(url.hostname, {}, (err) => {
          if (err) return reject(err);
          seen.push(init.headers);
          if (url.pathname === "/a") return resolve(redirect("https://evil2.example.com/b"));
          resolve(ok());
        });
      });
    const lk = lookupTo({ "api.example.com": ["93.184.216.34"], "evil2.example.com": ["93.184.216.35"] });
    const res = await safeFetch("https://api.example.com/a", {
      allowedHosts: ["api.example.com", "evil2.example.com"],
      lookup: lk,
      transport,
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    expect(seen[0]?.Authorization).toBe("Bearer t");
    expect(seen[1]?.Authorization).toBeUndefined();

    const loop: Transport = (_u, _i, l) =>
      new Promise((resolve) =>
        l("api.example.com", {}, () => resolve(redirect("https://api.example.com/loop"))),
      );
    await expect(
      safeFetch("https://api.example.com/loop", { allowedHosts, lookup, transport: loop, maxRedirects: 10 }),
    ).rejects.toThrow(/too_many_redirects/);
  });

  it("the real transport refuses a private resolution without connecting", async () => {
    await expect(
      safeFetch("https://example.com/", {
        allowedHosts: ["example.com"],
        lookup: lookupTo({ "example.com": ["127.0.0.1"] }),
        timeoutMs: 2000,
      }),
    ).rejects.toBeInstanceOf(Error);
    await expect(safeFetch("https://localhost/", { allowedHosts: ["localhost"] })).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  it("guarded lookup resolves public addresses and honours the `all` option", async () => {
    const guarded = createGuardedLookup(lookupTo({ "api.example.com": ["93.184.216.34"] }));
    await new Promise<void>((resolve, reject) =>
      guarded("api.example.com", { all: true }, (err, addrs) => {
        if (err) return reject(err);
        expect(addrs).toEqual([{ address: "93.184.216.34", family: 4 }]);
        resolve();
      }),
    );
    await new Promise<void>((resolve, reject) =>
      guarded("api.example.com", {}, (err, addr) => {
        if (err) return reject(err);
        expect(addr).toBe("93.184.216.34");
        resolve();
      }),
    );
  });
});

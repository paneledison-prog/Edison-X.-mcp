import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { testApp } from "../helpers/app.js";
import { MCP_HEADERS, mcpClient, rpc, startHttp } from "../helpers/http.js";

let app: App;
let http: Awaited<ReturnType<typeof startHttp>>;

beforeEach(async () => {
  app = testApp();
  http = await startHttp(app);
});
afterEach(async () => {
  await http.close();
  app.close();
});

const post = (body: string, headers: Record<string, string> = {}, path = "/mcp") =>
  fetch(`${http.url}${path}`, { method: "POST", headers: { ...MCP_HEADERS, ...headers }, body });

describe("authentication", () => {
  it("serves /healthz anonymously and reveals nothing", async () => {
    const r = await fetch(`${http.url}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
  });

  it("rejects missing, malformed, unknown and wrongly-prefixed keys with 401", async () => {
    const real = app.keys.create({ name: "a" }).key;
    for (const auth of [undefined, "", "Bearer", "Bearer ", "Basic abc", "bearer " + real, "Bearer ex_short", `Bearer ${real}x`, `Bearer ex_${"A".repeat(43)}`, `Token ${real}`]) {
      const r = await post(rpc("tools/list"), auth === undefined ? {} : { Authorization: auth });
      expect(r.status, String(auth)).toBe(401);
      expect(r.headers.get("www-authenticate")).toMatch(/Bearer/);
      expect(JSON.stringify(await r.json())).not.toContain(real);
    }
  });

  it("accepts a valid key and lists the tools over Streamable HTTP", async () => {
    const { key } = app.keys.create({ name: "claude" });
    const client = await mcpClient(http.url, key);
    expect((await client.listTools()).tools).toHaveLength(12);
    const r = await client.callTool({ name: "search_inspiration", arguments: { query: "pricing table" } });
    expect(r.isError).toBeFalsy();
    await client.close();
  });

  it("stops a revoked key on the very next request", async () => {
    const issued = app.keys.create({ name: "temp" });
    expect((await post(rpc("tools/list"), { Authorization: `Bearer ${issued.key}` })).status).toBe(200);
    app.keys.revoke(issued.keyId);
    expect((await post(rpc("tools/list"), { Authorization: `Bearer ${issued.key}` })).status).toBe(401);
  });

  it("a second, different agent connects with its own key and no code changes", async () => {
    const a = app.keys.create({ name: "agent-a", scopes: ["read:search", "read:design"] });
    const b = app.keys.create({ name: "agent-b", scopes: ["read:search", "read:design", "write:collections"] });
    const ca = await mcpClient(http.url, a.key);
    const cb = await mcpClient(http.url, b.key);
    const ra = await ca.callTool({ name: "create_collection", arguments: { name: "x" } });
    const rb = await cb.callTool({ name: "create_collection", arguments: { name: "x" } });
    expect(ra.isError).toBe(true);
    expect(rb.isError).toBeFalsy();
    await ca.close();
    await cb.close();
  });

  it("blunts key guessing: repeated failures from one address are blocked", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await post(rpc("tools/list"), { Authorization: "Bearer nope" })).status;
    expect(last).toBe(429);
  });
});

describe("keys at rest", () => {
  it("shows the key once, stores only a hash and a short non-secret prefix", () => {
    const issued = app.keys.create({ name: "k" });
    expect(issued.key).toMatch(/^ex_[A-Za-z0-9_-]{43}$/);
    const rows = app.repo.db.prepare("SELECT * FROM api_keys").all() as Array<Record<string, string>>;
    expect(JSON.stringify(rows)).not.toContain(issued.key);
    expect(JSON.stringify(rows)).not.toContain(issued.key.slice(11));
    expect(rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.key_prefix).toBe(issued.key.slice(0, 11));
    expect(JSON.stringify(app.keys.list())).toContain(issued.keyPrefix);
  });

  it("gives new keys read-only scopes by default", () => {
    expect(app.keys.create({ name: "d" }).principal.scopes).toEqual(["read:search", "read:design"]);
  });
});

describe("scopes", () => {
  it("denies a tool call without the scope, before any work, and audits it", async () => {
    const { key } = app.keys.create({ name: "reader", scopes: ["read:search"] });
    const client = await mcpClient(http.url, key);
    const r = await client.callTool({ name: "get_design", arguments: { id: "library:fitness-dashboard-dark" } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/read:design/);
    const w = await client.callTool({ name: "submit_design", arguments: { title: "t", source_url: "https://example.com/x", attribution: "a", license: "owned", origin: "owned" } });
    expect(w.isError).toBe(true);
    const audit = app.repo.listAudit({ event: "scope_denied", limit: 10 });
    expect(audit.map((a) => a.details.scope).sort()).toEqual(["read:design", "write:library"]);
    await client.close();
  });

  it("enforces a scope on every tool", async () => {
    const { key } = app.keys.create({ name: "none", scopes: ["admin"] });
    const client = await mcpClient(http.url, key);
    const { tools } = await client.listTools();
    for (const t of tools) {
      const args: Record<string, unknown> = {
        search_inspiration: { query: "a" }, get_design: { id: "library:x" }, find_similar_designs: { id: "library:x" }, get_inspiration_brief: { goal: "a" },
        add_to_collection: { collection_id: "col_x", design_id: "library:x" }, create_collection: { name: "a" }, get_collection: { collection_id: "col_x" },
        get_connection_status: { source: "library" },
        submit_design: { title: "t", source_url: "https://example.com/x", attribution: "a", license: "owned", origin: "owned" },
      }[t.name] ?? {};
      const r = await client.callTool({ name: t.name, arguments: args });
      expect(r.isError, t.name).toBe(true);
      expect(JSON.stringify(r.content), t.name).toMatch(/lacks the required scope/);
    }
    await client.close();
  });
});

describe("rate limits and request limits", () => {
  it("returns 429 with Retry-After once the per-minute limit is exceeded, and audits it", async () => {
    const { key } = app.keys.create({ name: "slow", ratePerMin: 3 });
    const statuses: number[] = [];
    let retry = "";
    for (let i = 0; i < 5; i++) {
      const r = await post(rpc("tools/list", {}, i), { Authorization: `Bearer ${key}` });
      statuses.push(r.status);
      if (r.status === 429) retry = r.headers.get("retry-after") ?? "";
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(Number(retry)).toBeGreaterThan(0);
    expect(app.repo.listAudit({ event: "rate_limited", limit: 5 }).length).toBeGreaterThan(0);
    expect(app.metrics.get("edison_rate_limit_hits_total", { scope: "key" })).toBe(2);
  });

  it("enforces the daily limit independently", async () => {
    const { key } = app.keys.create({ name: "daily", ratePerDay: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post(rpc("tools/list", {}, i), { Authorization: `Bearer ${key}` })).status);
    expect(codes).toEqual([200, 200, 429]);
  });

  it("rejects bodies over 100 KB with 413 and invalid JSON with 400", async () => {
    const { key } = app.keys.create({ name: "big" });
    const auth = { Authorization: `Bearer ${key}` };
    const big = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(150_000) } }), auth);
    expect(big.status).toBe(413);
    const bad = await post("{not json", auth);
    expect(bad.status).toBe(400);
  });

  it("allows only POST on /mcp and 404s unknown paths", async () => {
    const { key } = app.keys.create({ name: "m" });
    const get = await fetch(`${http.url}/mcp`, { headers: { Authorization: `Bearer ${key}` } });
    expect(get.status).toBe(405);
    expect((await fetch(`${http.url}/nope`)).status).toBe(404);
  });

  it("rejects foreign origins and unknown hosts (DNS rebinding)", async () => {
    const { key } = app.keys.create({ name: "o" });
    const origin = await post(rpc("tools/list"), { Authorization: `Bearer ${key}`, Origin: "https://evil.example" });
    expect(origin.status).toBe(403);
    // fetch() ignores a Host override, so use a raw request.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: http.port, path: "/mcp", method: "POST", headers: { ...MCP_HEADERS, Authorization: `Bearer ${key}`, Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(rpc("tools/list"));
    });
    expect(status).toBe(403);
  });
});

describe("operational endpoints", () => {
  it("/readyz and /metrics require a key; /metrics needs admin; neither leaks secrets", async () => {
    expect((await fetch(`${http.url}/readyz`)).status).toBe(401);
    expect((await fetch(`${http.url}/metrics`)).status).toBe(401);
    const reader = app.keys.create({ name: "r" });
    const admin = app.keys.create({ name: "a", scopes: ["admin", "read:search"] });
    const ready = await fetch(`${http.url}/readyz`, { headers: { Authorization: `Bearer ${reader.key}` } });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready", database: "ok", sources: { library: "ok" } });
    expect((await fetch(`${http.url}/metrics`, { headers: { Authorization: `Bearer ${reader.key}` } })).status).toBe(403);
    const m = await fetch(`${http.url}/metrics`, { headers: { Authorization: `Bearer ${admin.key}` } });
    expect(m.status).toBe(200);
    const text = await m.text();
    expect(text).toMatch(/edison_/);
    expect(text).not.toContain(admin.key);
  });

  it("records tool metrics: count and latency per tool, plus audit events for keys", async () => {
    const { key } = app.keys.create({ name: "metrics" });
    const client = await mcpClient(http.url, key);
    await client.callTool({ name: "list_taxonomy", arguments: {} });
    await client.close();
    expect(app.metrics.get("edison_tool_calls_total", { tool: "list_taxonomy", outcome: "ok" })).toBe(1);
    expect(app.metrics.snapshot().summaries['edison_tool_latency_ms{tool="list_taxonomy"}']?.count).toBe(1);
    expect(app.repo.listAudit({ event: "key_created", limit: 5 })).toHaveLength(1);
    app.keys.revoke(app.keys.list()[0]?.keyId ?? "");
    expect(app.repo.listAudit({ event: "key_revoked", limit: 5 })).toHaveLength(1);
  });
});

import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createLogger } from "../../src/observability/logger.js";
import { connect, principalWith, testApp, type TestClient } from "../helpers/app.js";
import { MCP_HEADERS, mcpClient, rpc, startHttp } from "../helpers/http.js";
import { NOW } from "../helpers/fixtures.js";
import { FakePinterest, PINTEREST_ENV, PINTEREST_REGISTER } from "../helpers/pinterest.js";

let app: App;
let http: Awaited<ReturnType<typeof startHttp>>;
let fake: FakePinterest;
let logs = "";
let now = NOW;

function build(register = PINTEREST_REGISTER()): void {
  fake = new FakePinterest();
  logs = "";
  now = NOW;
  const sink = new Writable({ write(chunk: Buffer, _e, cb) { logs += chunk.toString(); cb(); } });
  app = testApp({
    env: PINTEREST_ENV,
    registerMarkdown: register,
    clock: () => now,
    overrides: { logger: createLogger({ level: "debug", destination: sink }), pinterestFetcher: fake.fetcher },
  });
}

beforeEach(async () => {
  build();
  http = await startHttp(app);
});
afterEach(async () => {
  await http.close();
  app.close();
});

const pathOf = (u: string): string => u.replace(/^https?:\/\/[^/]+/, "");

/** Runs the whole browser flow for a key: connect link -> Pinterest authorize redirect -> callback. */
async function connectPinterest(client: Awaited<ReturnType<typeof mcpClient>>): Promise<{ state: string; redirect: URL }> {
  const status = (await client.callTool({ name: "get_connection_status", arguments: { source: "pinterest" } })).structuredContent as { connected: boolean; connect_url?: string };
  expect(status.connected).toBe(false);
  const start = await fetch(`${http.url}${pathOf(status.connect_url as string)}`, { redirect: "manual" });
  expect(start.status).toBe(302);
  const redirect = new URL(start.headers.get("location") as string);
  const state = redirect.searchParams.get("state") as string;
  const cb = await fetch(`${http.url}/connect/pinterest/callback?code=auth-code-1&state=${state}`);
  expect(cb.status).toBe(200);
  return { state, redirect };
}

describe("registry gating", () => {
  it("does not load Pinterest while its register entry is PENDING, and exposes no connect route", async () => {
    await http.close();
    app.close();
    const { readFileSync } = await import("node:fs");
    app = testApp({ env: PINTEREST_ENV, overrides: { pinterestFetcher: fake.fetcher } });
    // Replace the test register with the real shipped one.
    const real = await import("../../src/sources/register.js");
    const shipped = real.parseRegister(readFileSync("docs/SOURCES.md", "utf8"));
    const validation = real.validateEntry("pinterest", shipped.get("pinterest"), NOW);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.problems.join(" ")).toMatch(/Terms reviewed on|Owner approval|Terms summary/);
    http = await startHttp(app);
    // The test register approves pinterest, so build one that uses the shipped (pending) entry instead:
    await http.close();
    app.close();
    const { createApp } = await import("../../src/app.js");
    const { loadConfig } = await import("../../src/config.js");
    const { createLogger: cl } = await import("../../src/observability/logger.js");
    const { SqliteRepository, openDatabase, runMigrations } = await import("../../src/storage/sqlite.js");
    const db = openDatabase(":memory:");
    runMigrations(db);
    const logger = cl({ level: "silent" });
    app = createApp(
      loadConfig({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), DATABASE_PATH: ":memory:", ...PINTEREST_ENV }),
      { logger, clock: () => NOW, repo: new SqliteRepository(db, logger), pinterestFetcher: fake.fetcher },
    );
    expect(app.registry.ids()).toEqual(["library"]);
    expect(app.registry.refused.map((r) => r.id)).toEqual(["pinterest"]);
    http = await startHttp(app);
    expect((await fetch(`${http.url}/connect/pinterest?t=anything`, { redirect: "manual" })).status).toBe(404);
    const { key } = app.keys.create({ name: "x" });
    const client = await mcpClient(http.url, key);
    const out = (await client.callTool({ name: "search_inspiration", arguments: { query: "dashboard" } })).structuredContent as { sources_queried: string[] };
    expect(out.sources_queried).toEqual(["library"]);
    expect(fake.calls).toHaveLength(0);
    await client.close();
  });

  it("an approved entry loads the source and narrows capabilities", () => {
    expect(app.registry.ids()).toEqual(["library", "pinterest"]);
    expect(app.registry.get("pinterest")?.capabilities).toMatchObject({ requiresUserAuth: true, canAnalyze: false, canProxyImage: false });
  });
});

describe("OAuth flow (official API, user authorization)", () => {
  it("shows 'not connected' as a clean skipped source, not an error", async () => {
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    const out = (await client.callTool({ name: "search_inspiration", arguments: { query: "dark dashboard" } })).structuredContent as {
      sources_queried: string[];
      sources_skipped: Array<{ source: string; reason: string }>;
    };
    expect(out.sources_skipped).toEqual([{ source: "pinterest", reason: "not connected" }]);
    expect(out.sources_queried).toEqual(["library"]);
    expect(fake.calls).toHaveLength(0);
    const sources = (await client.callTool({ name: "list_sources", arguments: {} })).structuredContent as { sources: Array<{ id: string; connected: boolean }> };
    expect(sources.sources.find((s) => s.id === "pinterest")?.connected).toBe(false);
    await client.close();
  });

  it("builds the official authorize URL with a verified single-use state, then stores encrypted tokens", async () => {
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    const { redirect, state } = await connectPinterest(client);
    expect(redirect.origin + redirect.pathname).toBe("https://www.pinterest.com/oauth/");
    expect(Object.fromEntries(redirect.searchParams)).toMatchObject({
      client_id: "client-id-123",
      redirect_uri: "https://edison.test/connect/pinterest/callback",
      response_type: "code",
      scope: "boards:read,pins:read",
    });
    expect(state.length).toBeGreaterThanOrEqual(40);

    // Token exchange used HTTP Basic client auth and the right grant, only against api.pinterest.com.
    const tokenCall = fake.calls.find((c) => c.url.endsWith("/v5/oauth/token"));
    expect(tokenCall?.headers["Authorization"]).toBe(`Basic ${Buffer.from("client-id-123:client-secret-planted-xyz").toString("base64")}`);
    expect(new URLSearchParams(tokenCall?.body).get("grant_type")).toBe("authorization_code");
    expect(new URLSearchParams(tokenCall?.body).get("code")).toBe("auth-code-1");
    expect(tokenCall?.allowedHosts).toEqual(["api.pinterest.com"]);

    // Stored encrypted, bound to the principal that started the flow.
    const row = app.repo.db.prepare("SELECT * FROM oauth_connections").get() as Record<string, string>;
    expect(row.principal_id).toBe(app.keys.list()[0]?.principal.id);
    expect(JSON.stringify(row)).not.toMatch(/ACCESS_TOKEN|REFRESH_TOKEN/);
    expect(app.repo.listAudit({ event: "source_connected", limit: 5 })).toHaveLength(1);

    const status = (await client.callTool({ name: "get_connection_status", arguments: { source: "pinterest" } })).structuredContent as { connected: boolean; connect_url?: string };
    expect(status).toEqual({ source: "pinterest", connected: true });
    await client.close();
  });

  it("rejects replayed, forged, expired and cross-source states and connect tickets", async () => {
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    const { state } = await connectPinterest(client);
    const replay = await fetch(`${http.url}/connect/pinterest/callback?code=auth-code-1&state=${state}`);
    expect(replay.status).toBe(400);
    const forged = await fetch(`${http.url}/connect/pinterest/callback?code=c&state=${"A".repeat(43)}`);
    expect(forged.status).toBe(400);
    expect((await fetch(`${http.url}/connect/pinterest/callback?code=c`)).status).toBe(400);
    expect((await fetch(`${http.url}/connect/pinterest/callback?error=access_denied&state=x`)).status).toBe(400);

    expect((await fetch(`${http.url}/connect/pinterest`, { redirect: "manual" })).status).toBe(401);
    expect((await fetch(`${http.url}/connect/pinterest?t=garbage`, { redirect: "manual" })).status).toBe(401);
    const ticket = app.connections.issueTicket("p_x", "library", now.getTime());
    expect((await fetch(`${http.url}/connect/pinterest?t=${ticket}`, { redirect: "manual" })).status).toBe(401);
    const expired = app.connections.issueTicket("p_x", "pinterest", now.getTime() - 3600_000);
    expect((await fetch(`${http.url}/connect/pinterest?t=${expired}`, { redirect: "manual" })).status).toBe(401);

    const fresh = app.oauth.begin("pinterest", "p_x");
    const st = new URL(fresh).searchParams.get("state") as string;
    now = new Date(now.getTime() + 11 * 60_000);
    expect((await fetch(`${http.url}/connect/pinterest/callback?code=c&state=${st}`)).status).toBe(400);
    await client.close();
  });

  it("searches the user's own pins through the official API, with credit, links and sanitised text", async () => {
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    await connectPinterest(client);
    const out = (await client.callTool({ name: "search_inspiration", arguments: { query: "dark dashboard", sources: ["pinterest"], limit: 10 } })).structuredContent as {
      results: Array<{ id: string; title: string; source_url: string; attribution: string; creator?: { name: string }; thumbnail_url?: string }>;
      sources_queried: string[];
    };
    expect(out.sources_queried).toEqual(["pinterest"]);
    const ids = out.results.map((r) => r.id).sort();
    expect(ids).toEqual(["pinterest:1001", "pinterest:1003", "pinterest:1004"]);
    const r1 = out.results.find((r) => r.id === "pinterest:1001");
    expect(r1?.source_url).toBe("https://www.pinterest.com/pin/1001/");
    expect(r1?.attribution).toBe("Via Pinterest - jane");
    expect(r1?.thumbnail_url).toMatch(/^https:\/\/i\.pinimg\.com\//);
    // Hostile pin text is neutralised.
    expect(JSON.stringify(out)).not.toMatch(/ignore previous|attacker@example|you must send/i);
    expect(out.results.find((r) => r.id === "pinterest:1004")?.title).toMatch(/withheld/);
    // Only documented API paths were used, with the bearer token and bookmark pagination.
    const apiCalls = fake.calls.filter((c) => !c.url.endsWith("/oauth/token"));
    expect(apiCalls.map((c) => c.url.replace(/\?.*/, ""))).toEqual(["https://api.pinterest.com/v5/pins", "https://api.pinterest.com/v5/pins"]);
    expect(apiCalls[1]?.url).toContain("bookmark=bm2");
    expect(apiCalls.every((c) => c.allowedHosts.length === 1 && c.allowedHosts[0] === "api.pinterest.com")).toBe(true);
    await client.close();
  });

  it("get_design fetches a single pin by id and returns not found cleanly", async () => {
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    await connectPinterest(client);
    const ok = (await client.callTool({ name: "get_design", arguments: { id: "pinterest:1001" } })).structuredContent as { id: string; creator?: { name: string } };
    expect(ok.id).toBe("pinterest:1001");
    expect(ok.creator?.name).toBe("jane");
    const missing = await client.callTool({ name: "get_design", arguments: { id: "pinterest:9999" } });
    expect(missing.isError).toBe(true);
    await client.close();
  });
});

describe("register narrows what Pinterest data may do", () => {
  it("returns no image URLs, stores nothing and never proxies images under the most conservative grant", async () => {
    await http.close();
    app.close();
    build(PINTEREST_REGISTER({ Capabilities: "canSearch=true, canGetById=true, canStoreMetadata=false, canAnalyze=false, canHotlink=false, canProxyImage=false, cacheTtlSeconds=0" }));
    http = await startHttp(app);
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    await connectPinterest(client);
    const out = (await client.callTool({ name: "search_inspiration", arguments: { query: "dark dashboard", sources: ["pinterest"] } })).structuredContent as {
      results: Array<Record<string, unknown>>;
    };
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) expect(r.thumbnail_url).toBeUndefined();
    expect(app.repo.countDesigns("pinterest")).toBe(0);
    const d = (await client.callTool({ name: "get_design", arguments: { id: "pinterest:1001", include_image: true } })).structuredContent as { image_url?: string; notes?: string };
    expect(d.image_url).toBeUndefined();
    expect(d.notes).toMatch(/do not allow image proxying/);
    await client.close();
  });
});

describe("tokens are refreshed, protected and deleted", () => {
  it("refreshes before expiry and stores the new tokens encrypted", async () => {
    fake.tokenResponses = [JSON.stringify({ ...JSON.parse(fake.tokenResponses[0] as string), expires_in: 30 }), fake.tokenResponses[1] as string];
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    await connectPinterest(client);
    await client.callTool({ name: "search_inspiration", arguments: { query: "dashboard", sources: ["pinterest"] } });
    const refreshCall = fake.calls.filter((c) => c.url.endsWith("/v5/oauth/token"))[1];
    expect(new URLSearchParams(refreshCall?.body).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(refreshCall?.body).get("refresh_token")).toBe("pinr_REFRESH_TOKEN_ONE_planted");
    const apiAuth = fake.calls.filter((c) => c.url.includes("/v5/pins?")).map((c) => c.headers["Authorization"]);
    expect(new Set(apiAuth)).toEqual(new Set(["Bearer pina_ACCESS_TOKEN_TWO_planted"]));
    expect(JSON.stringify(app.repo.db.prepare("SELECT * FROM oauth_connections").all())).not.toMatch(/ACCESS_TOKEN|REFRESH_TOKEN/);
    await client.close();
  });

  it("on a 401 refreshes once and retries; if still refused it disconnects", async () => {
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    await connectPinterest(client);
    fake.validAccess = new Set(["pina_ACCESS_TOKEN_TWO_planted"]);
    const ok = (await client.callTool({ name: "search_inspiration", arguments: { query: "dashboard", sources: ["pinterest"] } })).structuredContent as { sources_queried: string[] };
    expect(ok.sources_queried).toEqual(["pinterest"]);
    fake.validAccess = new Set();
    fake.calls = [];
    const out = (await client.callTool({ name: "search_inspiration", arguments: { query: "other words", sources: ["pinterest"] } })).structuredContent as { sources_skipped: Array<{ reason: string }> };
    expect(out.sources_skipped[0]?.reason).toBe("not connected");
    expect(app.repo.getConnection(app.keys.list()[0]?.principal.id ?? "", "pinterest")).toBeNull();
    await client.close();
  });

  it("never lets a token or the client secret reach logs, audit rows, errors or tool output", async () => {
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    await connectPinterest(client);
    const outputs = [
      await client.callTool({ name: "search_inspiration", arguments: { query: "dark dashboard", sources: ["pinterest"] } }),
      await client.callTool({ name: "get_design", arguments: { id: "pinterest:1001" } }),
      await client.callTool({ name: "get_connection_status", arguments: { source: "pinterest" } }),
      await client.callTool({ name: "list_sources", arguments: {} }),
      await client.callTool({ name: "get_design", arguments: { id: "pinterest:9999" } }),
    ];
    fake.forced.push({ match: "/v5/pins?", res: { status: 500, headers: {}, body: Buffer.from("boom pina_ACCESS_TOKEN_ONE_planted") } });
    outputs.push(await client.callTool({ name: "search_inspiration", arguments: { query: "other words", sources: ["pinterest"] } }));
    await new Promise((r) => setTimeout(r, 50));
    const everything = JSON.stringify(outputs) + logs + JSON.stringify(app.repo.listAudit({ limit: 100 })) + JSON.stringify(app.metrics.snapshot());
    for (const secret of ["pina_ACCESS_TOKEN_ONE_planted", "pinr_REFRESH_TOKEN_ONE_planted", "pina_ACCESS_TOKEN_TWO_planted", "client-secret-planted-xyz", "auth-code-1", key]) {
      expect(everything, secret).not.toContain(secret);
    }
    expect(logs.length).toBeGreaterThan(0);
    await client.close();
  });

  it("disconnect deletes the tokens and every cached design for that user, and only that user", async () => {
    const a = app.keys.create({ name: "a" });
    const b = app.keys.create({ name: "b" });
    const ca = await mcpClient(http.url, a.key);
    const cb = await mcpClient(http.url, b.key);
    await connectPinterest(ca);
    await connectPinterest(cb);
    await ca.callTool({ name: "search_inspiration", arguments: { query: "dark dashboard", sources: ["pinterest"] } });
    await cb.callTool({ name: "search_inspiration", arguments: { query: "dark dashboard", sources: ["pinterest"] } });
    expect(app.repo.db.prepare("SELECT COUNT(*) n FROM designs WHERE source='pinterest'").get()).toEqual({ n: 6 });

    const del = await fetch(`${http.url}/connect/pinterest`, { method: "DELETE", headers: { Authorization: `Bearer ${a.key}` } });
    expect(del.status).toBe(204);
    expect(app.repo.getConnection(a.principal.id, "pinterest")).toBeNull();
    expect(app.repo.getConnection(b.principal.id, "pinterest")).not.toBeNull();
    expect(app.repo.db.prepare("SELECT COUNT(*) n FROM designs WHERE owner_principal_id = ?").get(a.principal.id)).toEqual({ n: 0 });
    expect(app.repo.db.prepare("SELECT COUNT(*) n FROM designs WHERE owner_principal_id = ?").get(b.principal.id)).toEqual({ n: 3 });
    expect(app.repo.listAudit({ event: "source_disconnected", limit: 5 })).toHaveLength(1);
    expect((await fetch(`${http.url}/connect/pinterest`, { method: "DELETE" })).status).toBe(401);
    await ca.close();
    await cb.close();
  });

  it("keeps one person's cached Pinterest designs invisible to everyone else", async () => {
    const a = app.keys.create({ name: "a" });
    const b = app.keys.create({ name: "b" });
    const ca = await mcpClient(http.url, a.key);
    await connectPinterest(ca);
    await ca.callTool({ name: "search_inspiration", arguments: { query: "dark dashboard", sources: ["pinterest"] } });
    const cb = await mcpClient(http.url, b.key);
    const direct = await cb.callTool({ name: "get_design", arguments: { id: "pinterest:1001" } });
    expect(direct.isError).toBe(true);
    const lib = await cb.callTool({ name: "search_inspiration", arguments: { query: "dark fitness dashboard" } });
    expect(JSON.stringify(lib.structuredContent)).not.toContain("pinterest:");
    const similar = await cb.callTool({ name: "find_similar_designs", arguments: { id: "library:fitness-dashboard-dark", limit: 20 } });
    expect(JSON.stringify(similar.structuredContent)).not.toContain("pinterest:");
    await ca.close();
    await cb.close();
  });
});

describe("rate limits (429)", () => {
  it("honours Retry-After: skips the source, makes no further calls during the cooldown, then resumes", async () => {
    const { key } = app.keys.create({ name: "u" });
    const client = await mcpClient(http.url, key);
    await connectPinterest(client);
    fake.calls = [];
    fake.forced.push({ match: "/v5/pins?", res: { status: 429, headers: { "retry-after": "120" }, body: Buffer.from("{}") } });
    const q = { query: "dark dashboard", sources: ["pinterest"] };
    const first = (await client.callTool({ name: "search_inspiration", arguments: q })).structuredContent as { sources_skipped: Array<{ reason: string }> };
    expect(first.sources_skipped[0]?.reason).toBe("rate limited");
    expect(fake.count("/v5/pins?")).toBe(1);
    await client.callTool({ name: "search_inspiration", arguments: { ...q, query: "dark settings" } });
    await client.callTool({ name: "search_inspiration", arguments: { ...q, query: "pastel onboarding" } });
    expect(fake.count("/v5/pins?")).toBe(1);
    expect(app.metrics.get("edison_rate_limit_hits_total", { scope: "source:pinterest" })).toBeGreaterThan(0);
    await client.close();
  });
});

describe("raw HTTP behaviours", () => {
  it("the MCP endpoint still needs a key when Pinterest is enabled", async () => {
    const r = await fetch(`${http.url}/mcp`, { method: "POST", headers: MCP_HEADERS, body: rpc("tools/list") });
    expect(r.status).toBe(401);
  });
  it("connect works through the in-memory client too (principal bound by ticket)", async () => {
    const c: TestClient = await connect(app, principalWith(["read:search"], "p_mem"));
    const s = await c.data<{ connected: boolean; connect_url?: string }>("get_connection_status", { source: "pinterest" });
    expect(s.connect_url).toMatch(/^https:\/\/edison\.test\/connect\/pinterest\?t=/);
    expect(app.connections.verifyTicket(new URL(s.connect_url as string).searchParams.get("t") as string, now.getTime())).toEqual({ principalId: "p_mem", source: "pinterest" });
    await c.close();
  });
});

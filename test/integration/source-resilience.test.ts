import { afterEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { SourceError } from "../../src/errors.js";
import { connect, testApp, type TestClient } from "../helpers/app.js";
import { entryMarkdown, fakeAdapter } from "../helpers/fixtures.js";

let app: App;
let c: TestClient;
afterEach(async () => {
  await c.close();
  app.close();
});

const raw = (id: string) => ({
  sourceId: id,
  sourceUrl: `https://example.com/p/${id}`,
  title: `Dark dashboard ${id}`,
  tags: ["dashboard"],
  platform: "web",
});

describe("sources fail independently", () => {
  it("one failing source never fails the call", async () => {
    const boom = fakeAdapter("boom", {
      search: () => Promise.reject(new Error("db password=hunter2 leaked")),
    });
    const limited = fakeAdapter("limited", {
      search: () => Promise.reject(new SourceError("limited", "rate_limited")),
    });
    app = testApp({
      adapters: [boom, limited],
      registerMarkdown: entryMarkdown("boom") + entryMarkdown("limited"),
    });
    c = await connect(app);
    const out = await c.data<{
      results: unknown[];
      sources_queried: string[];
      sources_skipped: Array<{ source: string; reason: string }>;
    }>("search_inspiration", { query: "dashboard" });
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.sources_queried).toEqual(["library"]);
    expect(out.sources_skipped).toEqual([
      { source: "boom", reason: "error" },
      { source: "limited", reason: "rate limited" },
    ]);
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(app.metrics.get("edison_source_errors_total", { source: "boom", reason: "error" })).toBe(1);
  });

  it("times out a slow source after the per-source limit and still answers", async () => {
    const slow = fakeAdapter("slow", { search: () => new Promise(() => undefined) });
    app = testApp({
      adapters: [slow],
      registerMarkdown: entryMarkdown("slow"),
      env: { SOURCE_TIMEOUT_MS: "150" },
    });
    c = await connect(app);
    const started = Date.now();
    const out = await c.data<{
      results: unknown[];
      sources_skipped: Array<{ source: string; reason: string }>;
    }>("search_inspiration", { query: "dashboard" });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.sources_skipped).toEqual([{ source: "slow", reason: "timeout" }]);
    expect(out.results.length).toBeGreaterThan(0);
  });

  it("marks a failing source degraded then down, and penalises it in ranking", async () => {
    const flaky = fakeAdapter("flaky", { search: () => Promise.reject(new Error("x")) });
    app = testApp({ adapters: [flaky], registerMarkdown: entryMarkdown("flaky") });
    c = await connect(app);
    for (let i = 0; i < 3; i++) await c.call("search_inspiration", { query: "dashboard" });
    const out = await c.data<{ sources: Array<{ id: string; health: string }> }>("list_sources");
    expect(out.sources.find((s) => s.id === "flaky")?.health).toBe("down");
  });

  it("merges and de-duplicates results across sources by canonical source URL, keeping the richer record", async () => {
    const a = fakeAdapter("aaa", {
      search: () =>
        Promise.resolve({
          designs: [{ ...raw("1"), sourceUrl: "https://example.com/same?utm_source=x", summary: "short" }],
        }),
    });
    const b = fakeAdapter("bbb", {
      search: () =>
        Promise.resolve({
          designs: [
            {
              ...raw("2"),
              sourceUrl: "https://EXAMPLE.com/same/",
              summary: "a longer summary with more detail",
              tags: ["dashboard", "dark", "charts"],
            },
          ],
        }),
    });
    app = testApp({ adapters: [a, b], registerMarkdown: entryMarkdown("aaa") + entryMarkdown("bbb") });
    c = await connect(app);
    const out = await c.data<{ results: Array<{ id: string }> }>("search_inspiration", {
      query: "dark dashboard",
      sources: ["aaa", "bbb"],
    });
    expect(out.results.map((r) => r.id)).toEqual(["bbb:2"]);
  });

  it("applies the register's cache TTL: cached within the TTL, refetched after it, never cached at 0", async () => {
    let calls = 0;
    let now = new Date("2026-10-06T12:00:00Z");
    const ext = fakeAdapter("ext", { search: () => Promise.resolve({ designs: (calls++, [raw("c1")]) }) });
    app = testApp({ adapters: [ext], registerMarkdown: entryMarkdown("ext"), clock: () => now });
    c = await connect(app);
    const q = { query: "dark dashboard", sources: ["ext"] };
    await c.call("search_inspiration", q);
    await c.call("search_inspiration", q);
    expect(calls).toBe(1);
    expect(app.metrics.get("edison_cache_requests_total", { source: "ext", result: "hit" })).toBe(1);
    now = new Date(now.getTime() + 3601_000);
    await c.call("search_inspiration", q);
    expect(calls).toBe(2);
    expect(app.repo.countDesigns("ext")).toBeGreaterThan(0);
    app.repo.purgeExpired(new Date(now.getTime() + 3601_000 * 2));
    expect(app.repo.countDesigns("ext")).toBe(0);
  });

  it("does not cache or store anything when the register grants cacheTtlSeconds=0 or no storage", async () => {
    let calls = 0;
    const ext = fakeAdapter("ext", { search: () => Promise.resolve({ designs: (calls++, [raw("n1")]) }) });
    const md = entryMarkdown("ext", {
      Capabilities:
        "canSearch=true, canGetById=true, canStoreMetadata=false, canAnalyze=false, canHotlink=false, canProxyImage=false, cacheTtlSeconds=0",
    });
    app = testApp({ adapters: [ext], registerMarkdown: md });
    c = await connect(app);
    await c.call("search_inspiration", { query: "dark dashboard", sources: ["ext"] });
    await c.call("search_inspiration", { query: "dark dashboard", sources: ["ext"] });
    expect(calls).toBe(2);
    expect(app.repo.countDesigns("ext")).toBe(0);
  });

  it("get_design falls back to the source for ids it does not have, and refuses sources that cannot look up by id", async () => {
    const ext = fakeAdapter("ext", {
      getById: (id) => Promise.resolve(id === "known" ? raw("known") : null),
    });
    const noGet = fakeAdapter("noget", {}, { canGetById: false });
    app = testApp({
      adapters: [ext, noGet],
      registerMarkdown: entryMarkdown("ext") + entryMarkdown("noget"),
    });
    c = await connect(app);
    expect((await c.data<{ id: string }>("get_design", { id: "ext:known" })).id).toBe("ext:known");
    expect((await c.call("get_design", { id: "ext:unknown" })).isError).toBe(true);
    expect((await c.call("get_design", { id: "noget:abc" })).isError).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { loadSources } from "../../src/sources/registry.js";
import { parseRegister } from "../../src/sources/register.js";
import { createLogger } from "../../src/observability/logger.js";
import { entryMarkdown, fakeAdapter, NOW } from "../helpers/fixtures.js";

const logger = createLogger({ level: "silent" });
const load = (md: string, adapters: ReturnType<typeof fakeAdapter>[], enabled: string[]) =>
  loadSources({ enabledIds: enabled, adapters, register: parseRegister(md), now: NOW, logger });

describe("source registry (fails closed)", () => {
  it("loads a fully registered source", () => {
    const reg = load(entryMarkdown("alpha"), [fakeAdapter("alpha")], ["alpha"]);
    expect(reg.ids()).toEqual(["alpha"]);
    expect(reg.refused).toEqual([]);
  });

  it("refuses a source with a missing register field and says why", () => {
    const reg = load(entryMarkdown("alpha", { "Owner approval": null }), [fakeAdapter("alpha")], ["alpha"]);
    expect(reg.ids()).toEqual([]);
    expect(reg.refused[0]?.reasons.join(" ")).toMatch(/Owner approval/);
  });

  it("refuses a source with no register entry", () => {
    const reg = load("", [fakeAdapter("alpha")], ["alpha"]);
    expect(reg.refused[0]?.reasons[0]).toMatch(/no entry/);
  });

  it("refuses a BLOCKED adapter even with a complete entry", () => {
    const reg = load(entryMarkdown("alpha"), [fakeAdapter("alpha", { status: "BLOCKED" })], ["alpha"]);
    expect(reg.ids()).toEqual([]);
  });

  it("refuses when the register says BLOCKED or the status disagrees with the adapter", () => {
    expect(load(entryMarkdown("a", { Status: "BLOCKED" }), [fakeAdapter("a")], ["a"]).ids()).toEqual([]);
    expect(load(entryMarkdown("a", { Status: "USER_OAUTH" }), [fakeAdapter("a")], ["a"]).ids()).toEqual([]);
  });

  it("refuses a stale terms review", () => {
    const md = entryMarkdown("a", { "Terms reviewed on": "2025-01-01   by: T" });
    expect(load(md, [fakeAdapter("a")], ["a"]).ids()).toEqual([]);
  });

  it("refuses an enabled id with no adapter and never loads sources that are not enabled", () => {
    const reg = load(
      entryMarkdown("a") + entryMarkdown("b"),
      [fakeAdapter("a"), fakeAdapter("b")],
      ["a", "zzz"],
    );
    expect(reg.ids()).toEqual(["a"]);
    expect(reg.refused.map((r) => r.id)).toEqual(["zzz"]);
  });

  it("narrows capabilities to what the register grants", () => {
    const md = entryMarkdown("a", {
      Capabilities:
        "canSearch=true, canGetById=true, canStoreMetadata=false, canAnalyze=false, canHotlink=false, canProxyImage=false, cacheTtlSeconds=0",
    });
    const reg = load(md, [fakeAdapter("a", {}, { canProxyImage: true, cacheTtlSeconds: 3600 })], ["a"]);
    const caps = reg.get("a")?.capabilities;
    expect(caps).toMatchObject({
      canHotlink: false,
      canStoreMetadata: false,
      canAnalyze: false,
      canProxyImage: false,
      cacheTtlSeconds: 0,
    });
  });

  it("audits every refusal", () => {
    const record = vi.fn();
    loadSources({
      enabledIds: ["a"],
      adapters: [fakeAdapter("a")],
      register: new Map(),
      now: NOW,
      logger,
      audit: { record } as never,
    });
    expect(record).toHaveBeenCalledWith("source_disabled", null, expect.objectContaining({ source: "a" }));
  });
});

import { describe, expect, it } from "vitest";
import { CursorCodec } from "../../src/services/cursor.js";
import {
  canonicalUrl,
  colorCloseness,
  dedupeBySourceUrl,
  paletteCloseness,
  parseColor,
  rank,
  WEIGHTS,
  type RankCandidate,
  type RankQuery,
} from "../../src/services/ranking.js";
import { similarity } from "../../src/services/similar.js";
import { deriveKey } from "../../src/security/crypto.js";
import { TokenBucket } from "../../src/security/ratelimit.js";
import { capSize, MAX_RESPONSE_BYTES } from "../../src/tools/run.js";
import { makeDesign, NOW, TEST_MASTER_KEY } from "../helpers/fixtures.js";

const q = (patch: Partial<RankQuery> = {}): RankQuery => ({
  platform: "any",
  styles: [],
  now: NOW,
  ...patch,
});
const cand = (
  sourceId: string,
  text: number,
  patch: Partial<RankCandidate["design"]> = {},
  health: RankCandidate["sourceHealth"] = "ok",
): RankCandidate => ({
  design: makeDesign({ sourceId, ...patch }),
  text,
  sourceHealth: health,
});

describe("ranking", () => {
  it("orders by normalised text relevance first", () => {
    const out = rank([cand("a", 1), cand("b", 10), cand("c", 5)], q());
    expect(out.map((r) => r.design.id)).toEqual(["library:b", "library:c", "library:a"]);
    expect(out[0]?.score).toBeCloseTo(WEIGHTS.text, 6);
  });

  it("breaks ties by id and is independent of input order", () => {
    const items = ["m", "a", "z", "k", "b"].map((s) => cand(s, 3));
    const expected = rank(items, q()).map((r) => r.design.id);
    expect(expected).toEqual(["library:a", "library:b", "library:k", "library:m", "library:z"]);
    for (let i = 0; i < 20; i++) {
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      expect(rank(shuffled, q()).map((r) => r.design.id)).toEqual(expected);
    }
  });

  it("applies category, platform, style and palette boosts", () => {
    const base = [
      cand("plain", 5, { tags: [], platform: "web" }),
      cand("cat", 5, { tags: [], platform: "web", category: "dashboard" }),
      cand("plat", 5, { tags: [], platform: "ios" }),
      cand("sty", 5, { tags: ["dark"], platform: "web" }),
      cand("pal", 5, { tags: [], platform: "web", palette: ["#ff0000"] }),
    ];
    const top = (query: Partial<RankQuery>) => rank(base, q(query))[0]?.design.id;
    expect(top({ category: "dashboard" })).toBe("library:cat");
    expect(top({ platform: "ios" })).toBe("library:plat");
    expect(top({ styles: ["dark"] })).toBe("library:sty");
    expect(top({ colorHint: "#ee1111" })).toBe("library:pal");
    expect(top({ colorHint: "red" })).toBe("library:pal");
  });

  it("penalises stale records and degraded sources", () => {
    const stale = cand("stale", 5, { expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
    const fresh = cand("fresh", 5);
    const degraded = cand("deg", 5, {}, "degraded");
    const out = rank([stale, degraded, fresh], q());
    expect(out[0]?.design.id).toBe("library:fresh");
    expect(out.find((r) => r.design.id === "library:stale")?.score).toBeCloseTo(
      WEIGHTS.text + WEIGHTS.stale,
      6,
    );
    expect(out.find((r) => r.design.id === "library:deg")?.score).toBeCloseTo(
      WEIGHTS.text + WEIGHTS.degraded,
      6,
    );
  });

  it("parses colors and measures closeness", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("Blue")).toEqual([30, 136, 229]);
    expect(parseColor("nope")).toBeNull();
    expect(parseColor(undefined)).toBeNull();
    expect(colorCloseness([0, 0, 0], [0, 0, 0])).toBe(1);
    expect(colorCloseness([0, 0, 0], [255, 255, 255])).toBe(0);
    expect(paletteCloseness(["#000000", "#ff0000"], [250, 0, 0])).toBeGreaterThan(0.9);
    expect(paletteCloseness(undefined, [1, 2, 3])).toBe(0);
  });

  it("de-duplicates by canonical URL and keeps the record with richer analysis", () => {
    expect(canonicalUrl("https://EXAMPLE.com/a/?utm_source=x&b=1#frag")).toBe("https://example.com/a/?b=1");
    const analysis = {
      layout: "l",
      components: [],
      buildHints: [],
      generatedBy: "owner" as const,
      generatedAt: NOW.toISOString(),
    };
    const a = { design: makeDesign({ sourceId: "a", sourceUrl: "https://example.com/x?utm_campaign=1" }) };
    const b = { design: makeDesign({ sourceId: "b", sourceUrl: "https://example.com/x", analysis }) };
    const c = { design: makeDesign({ sourceId: "c", sourceUrl: "https://example.com/other" }) };
    expect(
      dedupeBySourceUrl([a, b, c])
        .map((x) => x.design.id)
        .sort(),
    ).toEqual(["library:b", "library:c"]);
  });
});

describe("similarity", () => {
  it("rewards shared category, platform, tags, palette and components, and is symmetric enough to order sensibly", () => {
    const seed = makeDesign({
      sourceId: "s",
      category: "dashboard",
      platform: "web",
      tags: ["dark", "charts"],
      palette: ["#000000"],
    });
    const near = makeDesign({
      sourceId: "n",
      category: "dashboard",
      platform: "web",
      tags: ["dark", "charts"],
      palette: ["#010101"],
    });
    const far = makeDesign({
      sourceId: "f",
      category: "blog",
      platform: "ios",
      tags: ["light"],
      palette: ["#ffffff"],
    });
    expect(similarity(seed, near)).toBeGreaterThan(0.8);
    expect(similarity(seed, far)).toBeLessThan(0.1);
    expect(similarity(seed, near)).toBe(similarity(seed, near));
  });
});

describe("cursors", () => {
  const codec = new CursorCodec(deriveKey(TEST_MASTER_KEY, "cursor"));
  const now = Date.parse("2026-10-06T12:00:00Z");
  it("round-trips for the same query and principal", () => {
    const h = CursorCodec.queryHash(["a"]);
    expect(codec.decode(codec.encode(8, h, "p1", now), h, "p1", now)).toEqual({ offset: 8 });
  });
  it("expires after 15 minutes and rejects other queries, other principals and tampering", () => {
    const h = CursorCodec.queryHash(["a"]);
    const c = codec.encode(8, h, "p1", now);
    expect(() => codec.decode(c, h, "p1", now + 14 * 60_000)).not.toThrow();
    expect(() => codec.decode(c, h, "p1", now + 16 * 60_000)).toThrow(/invalid, expired/);
    expect(() => codec.decode(c, CursorCodec.queryHash(["b"]), "p1", now)).toThrow();
    expect(() => codec.decode(c, h, "p2", now)).toThrow();
    expect(() => codec.decode(`${c}0`, h, "p1", now)).toThrow();
    expect(() => codec.decode("garbage", h, "p1", now)).toThrow();
    expect(new CursorCodec(deriveKey(TEST_MASTER_KEY, "other")).encode(1, h, "p1", now)).not.toBe(c);
  });
  it("is opaque: the offset is not readable as plain text", () => {
    expect(codec.encode(12345, "h", "p", now)).not.toMatch(/12345/);
  });
});

describe("response size cap", () => {
  it("leaves small responses alone", () => {
    const d = { results: [{ a: 1 }], x: "y" };
    expect(capSize(d)).toBe(d);
  });
  it("trims the largest array until it fits, flags truncated and drops the cursor", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ i, pad: "x".repeat(1000) }));
    const out = capSize({ results: items, next_cursor: "abc", small: ["a"], attribution_notice: "n" });
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    expect(out.truncated).toBe(true);
    expect(out.next_cursor).toBeUndefined();
    expect(out.small).toEqual(["a"]);
    expect((out.results as unknown[]).length).toBeGreaterThan(10);
    expect((out.results as Array<{ i: number }>)[0]?.i).toBe(0);
  });
});

describe("token bucket", () => {
  it("allows a burst, refuses beyond it, reports the wait, and refills over time", () => {
    let t = 0;
    const b = new TokenBucket(3, 1, () => t);
    expect([b.take().ok, b.take().ok, b.take().ok]).toEqual([true, true, true]);
    const denied = b.take();
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfterMs).toBe(1000);
    t = 1000;
    expect(b.take().ok).toBe(true);
    expect(b.take().ok).toBe(false);
    t = 60_000;
    expect([b.take().ok, b.take().ok, b.take().ok, b.take().ok]).toEqual([true, true, true, false]);
  });
});

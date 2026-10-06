import type { Design, Platform, RequestContext } from "../sources/types.js";
import type { SearchService } from "./search.js";
import { UI_PATTERNS } from "./taxonomy.js";

export interface Brief {
  goal: string;
  based_on: Array<{ id: string; title: string; source_url: string; attribution: string }>;
  patterns: Array<{ pattern: string; evidence: string[] }>;
  suggested_components: string[];
  palette_suggestions: Array<{ name?: string; hex: string[] }>;
  typography_notes: string[];
  pitfalls: string[];
  confidence: "low" | "medium" | "high";
  analyzed_count: number;
}

const UI_PATTERN_SET: ReadonlySet<string> = new Set(UI_PATTERNS);

function groupBy<T>(items: T[], keys: (t: T) => string[]): Map<string, Set<T>> {
  const out = new Map<string, Set<T>>();
  for (const item of items) {
    for (const k of new Set(keys(item))) {
      const set = out.get(k) ?? new Set<T>();
      set.add(item);
      out.set(k, set);
    }
  }
  return out;
}

/**
 * Assemble a brief from retrieved data only. Every pattern cites at least two designs from
 * `based_on`. Server-authored prose is static; third-party strings appear only as values in
 * `key: value` pattern labels and in their own list fields, never inside sentences we write.
 */
export function buildBrief(goal: string, platform: Platform | "any", designs: Design[]): Brief {
  const ids = new Set(designs.map((d) => d.id));
  const analyzed = designs.filter((d) => d.analysis);
  const patterns: Brief["patterns"] = [];

  // Components that recur across analysed designs.
  const byComponent = groupBy(analyzed, (d) =>
    (d.analysis?.components ?? []).map((c) => c.toLowerCase().trim()).filter(Boolean),
  );
  const componentCounts = [...byComponent.entries()].map(([name, set]) => ({ name, designs: [...set] }));
  for (const c of componentCounts.filter((c) => c.designs.length >= 2)) {
    patterns.push({ pattern: `component: ${c.name}`, evidence: c.designs.map((d) => d.id).sort() });
  }
  // Known UI patterns and styles that recur in tags.
  const byTag = groupBy(designs, (d) => d.tags);
  for (const [tag, set] of byTag) {
    if (set.size < 2) continue;
    if (UI_PATTERN_SET.has(tag))
      patterns.push({ pattern: `ui-pattern: ${tag}`, evidence: [...set].map((d) => d.id).sort() });
  }
  // Shared density.
  const byDensity = groupBy(analyzed, (d) => (d.analysis?.density ? [d.analysis.density] : []));
  for (const [density, set] of byDensity) {
    if (set.size >= 2)
      patterns.push({
        pattern: `density: ${density} (${set.size} of ${analyzed.length} analysed references)`,
        evidence: [...set].map((d) => d.id).sort(),
      });
  }

  const safePatterns = patterns
    .filter((p) => p.evidence.length >= 2 && p.evidence.every((id) => ids.has(id)))
    .sort((a, b) => b.evidence.length - a.evidence.length || a.pattern.localeCompare(b.pattern))
    .slice(0, 10);

  const suggested = componentCounts
    .sort((a, b) => b.designs.length - a.designs.length || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map((c) => c.name);

  const palettes: Brief["palette_suggestions"] = [];
  for (const d of designs) {
    if (d.palette && d.palette.length > 0 && palettes.length < 3)
      palettes.push({ name: `Palette from ${d.id}`, hex: d.palette });
  }

  const typography = [
    ...new Set(analyzed.map((d) => d.analysis?.typography).filter((t): t is string => !!t)),
  ].slice(0, 6);

  const pitfalls = [
    "Use these references for structure and patterns; do not copy any design pixel for pixel.",
  ];
  if (designs.length === 0)
    pitfalls.push("No matching references were found; try broader words or a different platform.");
  const mobile =
    platform === "ios" ||
    platform === "android" ||
    designs.filter((d) => d.platform === "ios" || d.platform === "android").length * 2 > designs.length;
  if (mobile && designs.length > 0)
    pitfalls.push("Keep touch targets at least 44px and place primary actions within thumb reach.");
  if (designs.length > 0 && designs.filter((d) => d.tags.includes("dark")).length * 2 >= designs.length) {
    pitfalls.push("Check text contrast on dark surfaces and aim for 4.5:1 or better.");
  }
  if (
    analyzed.length > 0 &&
    analyzed.filter((d) => d.analysis?.density === "dense").length * 2 > analyzed.length
  ) {
    pitfalls.push(
      "Dense layouts need clear grouping and enough row height; test with realistic data volumes.",
    );
  }
  if (analyzed.length < 3)
    pitfalls.push(
      "Few references had structured analysis, so treat these patterns as hints and check the linked originals.",
    );

  return {
    goal,
    based_on: designs.map((d) => ({
      id: d.id,
      title: d.title,
      source_url: d.sourceUrl,
      attribution: d.attribution,
    })),
    patterns: safePatterns,
    suggested_components: suggested,
    palette_suggestions: palettes,
    typography_notes: typography,
    pitfalls,
    confidence: analyzed.length < 3 ? "low" : analyzed.length < 5 ? "medium" : "high",
    analyzed_count: analyzed.length,
  };
}

export class BriefService {
  constructor(private readonly search: SearchService) {}

  async brief(
    goal: string,
    platform: Platform | "any",
    maxDesigns: number,
    ctx: RequestContext,
  ): Promise<Brief> {
    const outcome = await this.search.search(
      { query: goal, platform, style: [], limit: maxDesigns, cursor: undefined },
      ctx,
    );
    return buildBrief(
      goal,
      platform,
      outcome.allRanked.slice(0, maxDesigns).map((r) => r.design),
    );
  }
}

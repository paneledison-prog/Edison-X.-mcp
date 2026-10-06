import type { Design, Platform } from "../sources/types.js";
import type { Health } from "../sources/registry.js";

/**
 * Deterministic ranking (Guidelines 6.7): normalised bm25 text relevance plus fixed boosts and
 * penalties, tie-broken by id. Identical inputs and data always give identical order.
 */

export interface RankQuery {
  platform: Platform | "any";
  category?: string;
  styles: string[];
  colorHint?: string;
  now: Date;
}

export interface RankCandidate {
  design: Design;
  /** Raw bm25-derived text score (higher is better, 0 = no match). */
  text: number;
  sourceHealth: Health;
}

export interface Ranked {
  design: Design;
  score: number;
}

export const WEIGHTS = {
  text: 1.0,
  category: 0.25,
  platform: 0.15,
  style: 0.1,
  palette: 0.2,
  analysis: 0.05,
  stale: -0.3,
  degraded: -0.15,
} as const;

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#e53935",
  orange: "#fb8c00",
  yellow: "#fdd835",
  green: "#43a047",
  teal: "#00897b",
  cyan: "#00acc1",
  blue: "#1e88e5",
  navy: "#1a237e",
  indigo: "#3949ab",
  purple: "#8e24aa",
  violet: "#7c4dff",
  pink: "#ec407a",
  brown: "#6d4c41",
  grey: "#757575",
  gray: "#757575",
  beige: "#f5f0e1",
  cream: "#fffdd0",
  gold: "#d4af37",
};

/** Accepts #rgb, #rrggbb or a basic color name. Returns [r,g,b] or null. */
export function parseColor(input: string | undefined): [number, number, number] | null {
  if (!input) return null;
  let v = input.trim().toLowerCase();
  if (NAMED_COLORS[v]) v = NAMED_COLORS[v] as string;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) v = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(v);
  if (!m) return null;
  return [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)];
}

/** 1 when identical, falling to 0 at a distance of 200 in RGB space. */
export function colorCloseness(a: [number, number, number], b: [number, number, number]): number {
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return Math.max(0, 1 - dist / 200);
}

export function paletteCloseness(
  palette: string[] | undefined,
  hint: [number, number, number] | null,
): number {
  if (!palette || palette.length === 0 || !hint) return 0;
  return Math.max(...palette.map((c) => colorCloseness(hint, parseColor(c) ?? [0, 0, 0])));
}

const r9 = (n: number): number => Math.round(n * 1e9) / 1e9;

export function rank(candidates: RankCandidate[], query: RankQuery): Ranked[] {
  const maxText = Math.max(0, ...candidates.map((c) => c.text));
  const hint = parseColor(query.colorHint);
  const styles = query.styles.map((s) => s.toLowerCase());
  const nowIso = query.now.toISOString();

  const scored = candidates.map(({ design: d, text, sourceHealth }) => {
    let score = (maxText > 0 ? text / maxText : 0) * WEIGHTS.text;
    if (query.category && d.category === query.category) score += WEIGHTS.category;
    if (query.platform !== "any" && d.platform === query.platform) score += WEIGHTS.platform;
    if (styles.length > 0) {
      const tags = new Set(d.tags.map((t) => t.toLowerCase()));
      score += (styles.filter((s) => tags.has(s)).length / styles.length) * WEIGHTS.style;
    }
    score += paletteCloseness(d.palette, hint) * WEIGHTS.palette;
    if (d.analysis) score += WEIGHTS.analysis;
    if (d.expiresAt && d.expiresAt <= nowIso) score += WEIGHTS.stale;
    if (sourceHealth !== "ok") score += WEIGHTS.degraded;
    return { design: d, score: r9(score) };
  });
  return scored.sort((a, b) => b.score - a.score || a.design.id.localeCompare(b.design.id));
}

/** Canonical form used for de-duplication: lowercase host, no tracking params, fragment or trailing slash. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (/^(utm_|ref$|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url;
  }
}

function richness(d: Design): number {
  return (d.analysis ? 1000 : 0) + (d.summary?.length ?? 0) + d.tags.length;
}

/** Keep one record per canonical sourceUrl: the one with richer analysis; ties resolve by id. */
export function dedupeBySourceUrl<T extends { design: Design }>(items: T[]): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const key = canonicalUrl(item.design.sourceUrl);
    const cur = best.get(key);
    if (
      !cur ||
      richness(item.design) > richness(cur.design) ||
      (richness(item.design) === richness(cur.design) && item.design.id.localeCompare(cur.design.id) < 0)
    ) {
      best.set(key, item);
    }
  }
  return [...best.values()];
}

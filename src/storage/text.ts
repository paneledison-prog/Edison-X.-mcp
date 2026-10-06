import type { DesignAnalysis } from "../sources/types.js";

/** Text indexed for search from a design's analysis. */
export function analysisText(a: DesignAnalysis | undefined): string {
  if (!a) return "";
  return [
    a.layout,
    a.components.join(" "),
    a.typography,
    a.colorUsage,
    a.interactionNotes,
    a.buildHints.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Words that match nearly everything and say nothing about a design. */
const STOPWORDS = new Set(
  "a an the and or of for with in on to at by from is are be this that it as my me i want need make build create design using like some something that's".split(
    " ",
  ),
);

/** FTS5 MATCH expression from plain terms. Only letters/digits survive, so no FTS syntax can be injected. */
export function buildFtsMatch(terms: string[]): string | null {
  const clean = [
    ...new Set(
      terms
        .flatMap((t) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u))
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
        .slice(0, 24),
    ),
  ];
  if (clean.length === 0) return null;
  return clean.map((t) => `"${t}"*`).join(" OR ");
}

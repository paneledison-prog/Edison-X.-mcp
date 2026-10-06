import Database from "better-sqlite3";
import type { Design } from "../sources/types.js";
import { analysisText, buildFtsMatch } from "./text.js";

/**
 * Scores candidates from any mix of sources with one FTS5 bm25 pass, so library and live results
 * are ranked on the same scale. Uses a throwaway in-memory index per call; nothing is persisted.
 */
export interface TextScorer {
  /** Higher is better. Candidates that do not match get 0. */
  score(terms: string[], designs: Design[]): Map<string, number>;
}

export class FtsTextScorer implements TextScorer {
  score(terms: string[], designs: Design[]): Map<string, number> {
    const out = new Map<string, number>(designs.map((d) => [d.id, 0]));
    const match = buildFtsMatch(terms);
    if (!match || designs.length === 0) return out;
    const db = new Database(":memory:");
    try {
      db.exec(
        "CREATE VIRTUAL TABLE t USING fts5(id UNINDEXED, title, tags, summary, analysis_text, category, tokenize = 'porter unicode61')",
      );
      const insert = db.prepare(
        "INSERT INTO t (id, title, tags, summary, analysis_text, category) VALUES (?, ?, ?, ?, ?, ?)",
      );
      // Sorted insertion keeps corpus statistics identical across runs.
      for (const d of [...designs].sort((a, b) => a.id.localeCompare(b.id))) {
        insert.run(
          d.id,
          d.title,
          d.tags.join(" "),
          d.summary ?? "",
          analysisText(d.analysis),
          d.category ?? "",
        );
      }
      const rows = db
        .prepare("SELECT id, bm25(t, 0.0, 10.0, 6.0, 3.0, 2.0, 4.0) AS rank FROM t WHERE t MATCH ?")
        .all(match) as Array<{ id: string; rank: number }>;
      for (const r of rows) out.set(r.id, -r.rank);
    } finally {
      db.close();
    }
    return out;
  }
}

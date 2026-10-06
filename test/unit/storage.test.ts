import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/storage/migrations/index.js";
import { buildFtsMatch } from "../../src/storage/text.js";
import { openDatabase, runMigrations, SqliteRepository } from "../../src/storage/sqlite.js";
import { makeDesign, NOW } from "../helpers/fixtures.js";

const viewer = (id = "p1") => ({ principalId: id, now: NOW });

describe("migrations", () => {
  it("apply on an empty database, in order, once", () => {
    const db = openDatabase(":memory:");
    expect(runMigrations(db)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(runMigrations(db)).toEqual([]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
    for (const t of ["designs", "designs_fts", "principals", "api_keys", "oauth_connections", "collections", "collection_items", "audit_log", "rate_limit_state"]) {
      expect(tables).toContain(t);
    }
  });

  it("apply on a populated database without losing rows, FTS links or keys", () => {
    const db = openDatabase(":memory:");
    runMigrations(db, MIGRATIONS.filter((m) => m.id <= 1));
    db.prepare(
      `INSERT INTO designs (id, source, source_id, title, source_url, attribution, platform, tags, fetched_at) VALUES
       ('library:a','library','a','Alpha dashboard','https://example.com/a','x','web','["dashboard"]','2026-10-01T00:00:00Z')`,
    ).run();
    db.prepare("INSERT INTO designs_fts (rowid, title, tags, summary, analysis_text, category) VALUES (1, 'Alpha dashboard', 'dashboard', '', '', '')").run();
    db.prepare("INSERT INTO principals (id, name, scopes, created_at) VALUES ('p','n','[\"read:search\"]','2026-10-01T00:00:00Z')").run();
    expect(runMigrations(db)).toEqual([2, 3]);
    expect(db.prepare("SELECT id, owner_key FROM designs").all()).toEqual([{ id: "library:a", owner_key: "" }]);
    const repo = new SqliteRepository(db);
    expect(repo.searchByTerms(["alpha"], { limit: 5, viewer: viewer() }).map((h) => h.design.id)).toEqual(["library:a"]);
    expect(repo.getPrincipal("p")?.name).toBe("n");
    // New writes work against the rebuilt table.
    repo.upsertDesign(makeDesign({ sourceId: "b", title: "Beta dashboard" }));
    expect(repo.countDesigns()).toBe(2);
  });
});

describe("design storage", () => {
  const repo = () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    return new SqliteRepository(db);
  };

  it("keeps per-owner copies of the same design id separate", () => {
    const r = repo();
    const d = makeDesign({ source: "pin", sourceId: "1", title: "Shared pin id" });
    r.upsertDesign(d, { ownerPrincipalId: "a" });
    r.upsertDesign({ ...d, title: "Shared pin id (b)" }, { ownerPrincipalId: "b" });
    expect(r.countDesigns("pin")).toBe(2);
    expect(r.getDesign("pin:1", viewer("a"))?.title).toBe("Shared pin id");
    expect(r.getDesign("pin:1", viewer("b"))?.title).toBe("Shared pin id (b)");
    expect(r.getDesign("pin:1", viewer("c"))).toBeNull();
    expect(r.searchByTerms(["shared"], { limit: 10, viewer: viewer("c") })).toEqual([]);
    expect(r.purgePrincipalSource("a", "pin")).toBe(1);
    expect(r.getDesign("pin:1", viewer("b"))).not.toBeNull();
  });

  it("hides expired rows and purges them", () => {
    const r = repo();
    r.upsertDesign(makeDesign({ sourceId: "e", expiresAt: new Date(NOW.getTime() - 1000).toISOString() }));
    r.upsertDesign(makeDesign({ sourceId: "f", expiresAt: new Date(NOW.getTime() + 1000).toISOString() }));
    expect(r.getDesign("library:e", viewer())).toBeNull();
    expect(r.getDesign("library:f", viewer())).not.toBeNull();
    expect(r.purgeExpired(NOW)).toBe(1);
    expect(r.countDesigns()).toBe(1);
  });

  it("never overwrites owner analysis with model analysis, but lets the owner replace it", () => {
    const r = repo();
    const base = { layout: "L", components: ["card"], buildHints: [], generatedAt: NOW.toISOString() };
    r.upsertDesign(makeDesign({ sourceId: "x", analysis: { ...base, generatedBy: "owner", layout: "owner layout" } }));
    expect(r.setModelAnalysis("library:x", { ...base, generatedBy: "model", layout: "model layout" })).toBe(false);
    r.upsertDesign(makeDesign({ sourceId: "x", analysis: { ...base, generatedBy: "model", layout: "sneaky" } }));
    expect(r.getDesign("library:x", viewer())?.analysis?.layout).toBe("owner layout");
    r.upsertDesign(makeDesign({ sourceId: "x" }));
    expect(r.getDesign("library:x", viewer())?.analysis?.layout).toBe("owner layout");
    expect(r.setOwnerAnalysis("library:x", { ...base, generatedBy: "owner", layout: "new owner layout" })).toBe(true);
    expect(r.getDesign("library:x", viewer())?.analysis?.layout).toBe("new owner layout");
    r.upsertDesign(makeDesign({ sourceId: "y" }));
    expect(r.setModelAnalysis("library:y", { ...base, generatedBy: "model" })).toBe(true);
    expect(r.setModelAnalysis("library:y", { ...base, generatedBy: "owner" })).toBe(false);
  });

  it("indexes analysis text for search and keeps the FTS index in sync on delete", () => {
    const r = repo();
    r.upsertDesign(makeDesign({ sourceId: "z", title: "Plain", tags: [] }));
    expect(r.searchByTerms(["kanban"], { limit: 5, viewer: viewer() })).toEqual([]);
    r.setModelAnalysis("library:z", { layout: "Kanban board", components: ["kanban column"], buildHints: [], generatedBy: "model", generatedAt: NOW.toISOString() });
    expect(r.searchByTerms(["kanban"], { limit: 5, viewer: viewer() }).map((h) => h.design.id)).toEqual(["library:z"]);
    expect(r.deleteDesign("library:z")).toBe(true);
    expect(r.searchByTerms(["kanban"], { limit: 5, viewer: viewer() })).toEqual([]);
    expect(r.deleteDesign("library:z")).toBe(false);
  });

  it("is safe against FTS syntax and SQL injection in search terms", () => {
    const r = repo();
    r.upsertDesign(makeDesign({ sourceId: "q", title: "Quiet design" }));
    for (const evil of ['"; DROP TABLE designs; --', "a OR b NEAR(c d)", "* AND NOT x", "title:secret", "'); DELETE FROM designs; --"]) {
      expect(() => r.searchByTerms([evil], { limit: 5, viewer: viewer() })).not.toThrow();
    }
    expect(r.countDesigns()).toBe(1);
    expect(buildFtsMatch(['"; DROP'])).toBe('"drop"*');
    expect(buildFtsMatch(["the a an with"])).toBeNull();
  });

  it("drops stored rows that fail validation instead of returning them", () => {
    const r = repo();
    r.upsertDesign(makeDesign({ sourceId: "ok" }));
    r.db.prepare("UPDATE designs SET source_url = 'http://insecure.example/x' WHERE id = 'library:ok'").run();
    expect(r.getDesign("library:ok", viewer())).toBeNull();
  });

  it("backs up consistently and the backup opens as a working database", async () => {
    const r = repo();
    r.upsertDesign(makeDesign({ sourceId: "bk", title: "Backup me" }));
    const file = `${process.env.TMPDIR ?? "/tmp"}/edison-backup-${Date.now()}.db`;
    await r.backupTo(file);
    const copy = new SqliteRepository(openDatabase(file));
    expect(copy.getDesign("library:bk", viewer())?.title).toBe("Backup me");
    expect(copy.searchByTerms(["backup"], { limit: 3, viewer: viewer() })).toHaveLength(1);
    copy.close();
  });
});

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Principal } from "../auth/scopes.js";
import { ScopeSchema } from "../auth/scopes.js";
import { DesignSchema, type Design, type DesignAnalysis } from "../sources/types.js";
import { MIGRATIONS, type Migration } from "./migrations/index.js";
import type {
  AuditEntry,
  Collection,
  DesignWriteOptions,
  KeyRecord,
  NewKey,
  OAuthConnectionRow,
  Repository,
  ScoredDesign,
  SourceCacheEntry,
  ViewerContext,
} from "./repository.js";
import type { Logger } from "../observability/logger.js";
import { analysisText, buildFtsMatch } from "./text.js";

type Row = Record<string, unknown>;
export type Db = Database.Database;

const BM25 = "bm25(designs_fts, 10.0, 6.0, 3.0, 2.0, 4.0)";

/** Apply pending migrations in order. Each runs in its own transaction. Returns ids applied. */
export function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): number[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const done = new Set((db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: number }>).map((r) => r.id));
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    })();
    applied.push(m.id);
  }
  return applied;
}

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

const j = (v: unknown): string => JSON.stringify(v);

export class SqliteRepository implements Repository {
  constructor(
    readonly db: Db,
    private readonly logger?: Logger,
  ) {}

  static open(path: string, logger?: Logger): SqliteRepository {
    const db = openDatabase(path);
    runMigrations(db);
    return new SqliteRepository(db, logger);
  }

  // ---------- designs ----------

  private rowToDesign(row: Row): Design | null {
    const candidate = {
      id: row.id,
      source: row.source,
      sourceId: row.source_id,
      title: row.title,
      sourceUrl: row.source_url,
      imageUrl: row.image_url ?? undefined,
      thumbnailUrl: row.thumbnail_url ?? undefined,
      creator: row.creator_name ? { name: row.creator_name, url: row.creator_url ?? undefined } : undefined,
      license: row.license ?? undefined,
      attribution: row.attribution,
      platform: row.platform,
      category: row.category ?? undefined,
      tags: JSON.parse(row.tags as string) as unknown,
      palette: row.palette ? (JSON.parse(row.palette as string) as unknown) : undefined,
      summary: row.summary ?? undefined,
      analysis: row.analysis ? (JSON.parse(row.analysis as string) as unknown) : undefined,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at ?? undefined,
    };
    const parsed = DesignSchema.safeParse(candidate);
    if (!parsed.success) {
      this.logger?.warn({ id: row.id, issues: parsed.error.issues.length }, "dropping design row that fails validation");
      return null;
    }
    return parsed.data;
  }

  upsertDesign(d: Design, opts: DesignWriteOptions = {}): void {
    const tx = this.db.transaction(() => {
      const existing = this.db.prepare("SELECT rid, analysis, analysis_by FROM designs WHERE id = ?").get(d.id) as
        | { rid: number; analysis: string | null; analysis_by: string | null }
        | undefined;

      // Owner analysis is never overwritten by model analysis; absent analysis never wipes existing analysis.
      let analysis = d.analysis;
      if (existing?.analysis) {
        const existingBy = existing.analysis_by;
        if (!analysis) analysis = JSON.parse(existing.analysis) as DesignAnalysis;
        else if (existingBy === "owner" && analysis.generatedBy === "model") analysis = JSON.parse(existing.analysis) as DesignAnalysis;
      }

      const params = {
        id: d.id,
        source: d.source,
        source_id: d.sourceId,
        title: d.title,
        source_url: d.sourceUrl,
        image_url: d.imageUrl ?? null,
        thumbnail_url: d.thumbnailUrl ?? null,
        creator_name: d.creator?.name ?? null,
        creator_url: d.creator?.url ?? null,
        license: d.license ?? null,
        attribution: d.attribution,
        platform: d.platform,
        category: d.category ?? null,
        tags: j(d.tags),
        palette: d.palette ? j(d.palette) : null,
        summary: d.summary ?? null,
        analysis: analysis ? j(analysis) : null,
        analysis_by: analysis?.generatedBy ?? null,
        owner_principal_id: opts.ownerPrincipalId ?? null,
        submitted_by: opts.submittedBy ?? null,
        fetched_at: d.fetchedAt,
        expires_at: d.expiresAt ?? null,
      };
      this.db
        .prepare(
          `INSERT INTO designs (id, source, source_id, title, source_url, image_url, thumbnail_url, creator_name, creator_url,
             license, attribution, platform, category, tags, palette, summary, analysis, analysis_by, owner_principal_id,
             submitted_by, fetched_at, expires_at)
           VALUES (@id, @source, @source_id, @title, @source_url, @image_url, @thumbnail_url, @creator_name, @creator_url,
             @license, @attribution, @platform, @category, @tags, @palette, @summary, @analysis, @analysis_by,
             @owner_principal_id, @submitted_by, @fetched_at, @expires_at)
           ON CONFLICT(id) DO UPDATE SET
             title=excluded.title, source_url=excluded.source_url, image_url=excluded.image_url,
             thumbnail_url=excluded.thumbnail_url, creator_name=excluded.creator_name, creator_url=excluded.creator_url,
             license=excluded.license, attribution=excluded.attribution, platform=excluded.platform,
             category=excluded.category, tags=excluded.tags, palette=excluded.palette, summary=excluded.summary,
             analysis=excluded.analysis, analysis_by=excluded.analysis_by, fetched_at=excluded.fetched_at,
             expires_at=excluded.expires_at`,
        )
        .run(params);
      const rid = (this.db.prepare("SELECT rid FROM designs WHERE id = ?").get(d.id) as { rid: number }).rid;
      this.db.prepare("DELETE FROM designs_fts WHERE rowid = ?").run(rid);
      this.db
        .prepare("INSERT INTO designs_fts (rowid, title, tags, summary, analysis_text, category) VALUES (?, ?, ?, ?, ?, ?)")
        .run(rid, d.title, d.tags.join(" "), d.summary ?? "", analysisText(analysis), d.category ?? "");
    });
    tx();
  }

  private visibleClause(sourcesLen: number): string {
    return `(d.expires_at IS NULL OR d.expires_at > @now) AND (d.owner_principal_id IS NULL OR d.owner_principal_id = @viewer)${
      sourcesLen > 0 ? ` AND d.source IN (${Array.from({ length: sourcesLen }, (_, i) => `@s${i}`).join(",")})` : ""
    }`;
  }

  getDesign(id: string, viewer: ViewerContext): Design | null {
    const row = this.db
      .prepare(
        `SELECT d.* FROM designs d WHERE d.id = @id AND ${this.visibleClause(0)}`,
      )
      .get({ id, now: viewer.now.toISOString(), viewer: viewer.principalId }) as Row | undefined;
    return row ? this.rowToDesign(row) : null;
  }

  searchByTerms(
    terms: string[],
    opts: { sources?: string[]; limit: number; viewer: ViewerContext },
  ): ScoredDesign[] {
    const match = buildFtsMatch(terms);
    if (!match) return [];
    const sources = opts.sources ?? [];
    const params: Record<string, unknown> = {
      match,
      now: opts.viewer.now.toISOString(),
      viewer: opts.viewer.principalId,
      limit: opts.limit,
    };
    sources.forEach((s, i) => (params[`s${i}`] = s));
    const rows = this.db
      .prepare(
        `SELECT d.*, ${BM25} AS rank FROM designs_fts JOIN designs d ON d.rid = designs_fts.rowid
         WHERE designs_fts MATCH @match AND ${this.visibleClause(sources.length)}
         ORDER BY rank ASC, d.id ASC LIMIT @limit`,
      )
      .all(params) as Row[];
    const out: ScoredDesign[] = [];
    for (const r of rows) {
      const design = this.rowToDesign(r);
      if (design) out.push({ design, score: -(r.rank as number) });
    }
    return out;
  }

  similarityCandidates(
    seed: Design,
    opts: { sources?: string[]; limit: number; viewer: ViewerContext },
  ): Design[] {
    const sources = opts.sources ?? [];
    const params: Record<string, unknown> = {
      seedId: seed.id,
      category: seed.category ?? null,
      platform: seed.platform,
      now: opts.viewer.now.toISOString(),
      viewer: opts.viewer.principalId,
      limit: opts.limit,
    };
    sources.forEach((s, i) => (params[`s${i}`] = s));
    const byCategory = this.db
      .prepare(
        `SELECT d.* FROM designs d WHERE d.id != @seedId AND (d.category = @category OR d.platform = @platform)
         AND ${this.visibleClause(sources.length)} ORDER BY d.id ASC LIMIT @limit`,
      )
      .all(params) as Row[];
    const merged = new Map<string, Design>();
    for (const r of byCategory) {
      const d = this.rowToDesign(r);
      if (d) merged.set(d.id, d);
    }
    for (const { design } of this.searchByTerms([...seed.tags, ...seed.title.split(/\s+/)], {
      sources: opts.sources,
      limit: opts.limit,
      viewer: opts.viewer,
    })) {
      if (design.id !== seed.id) merged.set(design.id, design);
    }
    return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  countDesigns(source?: string): number {
    const row = (
      source
        ? this.db.prepare("SELECT COUNT(*) AS n FROM designs WHERE source = ?").get(source)
        : this.db.prepare("SELECT COUNT(*) AS n FROM designs").get()
    ) as { n: number };
    return row.n;
  }

  private writeAnalysis(id: string, analysis: DesignAnalysis, allowOverwriteOwner: boolean): boolean {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare("SELECT rid, title, tags, summary, category, analysis_by FROM designs WHERE id = ?").get(id) as
        | { rid: number; title: string; tags: string; summary: string | null; category: string | null; analysis_by: string | null }
        | undefined;
      if (!row) return false;
      if (!allowOverwriteOwner && row.analysis_by === "owner") return false;
      this.db
        .prepare("UPDATE designs SET analysis = ?, analysis_by = ?, analysis_failed_at = NULL WHERE id = ?")
        .run(j(analysis), analysis.generatedBy, id);
      this.db.prepare("DELETE FROM designs_fts WHERE rowid = ?").run(row.rid);
      this.db
        .prepare("INSERT INTO designs_fts (rowid, title, tags, summary, analysis_text, category) VALUES (?, ?, ?, ?, ?, ?)")
        .run(row.rid, row.title, (JSON.parse(row.tags) as string[]).join(" "), row.summary ?? "", analysisText(analysis), row.category ?? "");
      return true;
    });
    return tx();
  }

  setModelAnalysis(id: string, analysis: DesignAnalysis): boolean {
    if (analysis.generatedBy !== "model") return false;
    return this.writeAnalysis(id, analysis, false);
  }

  setOwnerAnalysis(id: string, analysis: DesignAnalysis): boolean {
    if (analysis.generatedBy !== "owner") return false;
    return this.writeAnalysis(id, analysis, true);
  }

  markAnalysisFailed(id: string, at: Date): void {
    this.db.prepare("UPDATE designs SET analysis_failed_at = ? WHERE id = ?").run(at.toISOString(), id);
  }

  listNeedingAnalysis(opts: { sources: string[]; limit: number; now: Date }): Design[] {
    if (opts.sources.length === 0) return [];
    const ph = opts.sources.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM designs WHERE analysis IS NULL AND analysis_failed_at IS NULL AND source IN (${ph})
         AND (expires_at IS NULL OR expires_at > ?) ORDER BY id ASC LIMIT ?`,
      )
      .all(...opts.sources, opts.now.toISOString(), opts.limit) as Row[];
    return rows.map((r) => this.rowToDesign(r)).filter((d): d is Design => d !== null);
  }

  deleteDesign(id: string): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT rid FROM designs WHERE id = ?").get(id) as { rid: number } | undefined;
      if (!row) return false;
      this.db.prepare("DELETE FROM designs_fts WHERE rowid = ?").run(row.rid);
      this.db.prepare("DELETE FROM designs WHERE rid = ?").run(row.rid);
      this.db.prepare("DELETE FROM collection_items WHERE design_id = ?").run(id);
      this.db.prepare("DELETE FROM source_cache WHERE design_ids LIKE ?").run(`%"${id}"%`);
      return true;
    })();
  }

  purgeSource(source: string): number {
    return this.db.transaction(() => {
      const rids = this.db.prepare("SELECT rid, id FROM designs WHERE source = ?").all(source) as Array<{ rid: number; id: string }>;
      for (const r of rids) {
        this.db.prepare("DELETE FROM designs_fts WHERE rowid = ?").run(r.rid);
        this.db.prepare("DELETE FROM collection_items WHERE design_id = ?").run(r.id);
      }
      this.db.prepare("DELETE FROM designs WHERE source = ?").run(source);
      this.db.prepare("DELETE FROM source_cache WHERE source = ?").run(source);
      return rids.length;
    })();
  }

  purgeExpired(now: Date): number {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT rid, id FROM designs WHERE expires_at IS NOT NULL AND expires_at <= ?")
        .all(now.toISOString()) as Array<{ rid: number; id: string }>;
      for (const r of rows) {
        this.db.prepare("DELETE FROM designs_fts WHERE rowid = ?").run(r.rid);
        this.db.prepare("DELETE FROM designs WHERE rid = ?").run(r.rid);
        this.db.prepare("DELETE FROM collection_items WHERE design_id = ?").run(r.id);
      }
      this.db.prepare("DELETE FROM source_cache WHERE expires_at <= ?").run(now.toISOString());
      return rows.length;
    })();
  }

  purgePrincipalSource(principalId: string, source: string): number {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT rid, id FROM designs WHERE owner_principal_id = ? AND source = ?")
        .all(principalId, source) as Array<{ rid: number; id: string }>;
      for (const r of rows) {
        this.db.prepare("DELETE FROM designs_fts WHERE rowid = ?").run(r.rid);
        this.db.prepare("DELETE FROM designs WHERE rid = ?").run(r.rid);
        this.db.prepare("DELETE FROM collection_items WHERE design_id = ?").run(r.id);
      }
      this.db.prepare("DELETE FROM source_cache WHERE principal_id = ? AND source = ?").run(principalId, source);
      return rows.length;
    })();
  }

  getSourceCache(key: string, now: Date): SourceCacheEntry | null {
    const row = this.db
      .prepare("SELECT design_ids, total_estimate FROM source_cache WHERE cache_key = ? AND expires_at > ?")
      .get(key, now.toISOString()) as { design_ids: string; total_estimate: number | null } | undefined;
    if (!row) return null;
    return { designIds: JSON.parse(row.design_ids) as string[], totalEstimate: row.total_estimate };
  }

  putSourceCache(key: string, source: string, principalId: string, entry: SourceCacheEntry, expiresAt: Date): void {
    this.db
      .prepare(
        `INSERT INTO source_cache (cache_key, source, principal_id, design_ids, total_estimate, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET design_ids=excluded.design_ids, total_estimate=excluded.total_estimate,
           expires_at=excluded.expires_at`,
      )
      .run(key, source, principalId, j(entry.designIds), entry.totalEstimate, expiresAt.toISOString());
  }

  // ---------- auth ----------

  private rowToPrincipal(row: Row): Principal {
    return {
      id: row.p_id as string,
      name: row.p_name as string,
      scopes: (JSON.parse(row.p_scopes as string) as unknown[]).map((s) => ScopeSchema.parse(s)),
      createdAt: row.p_created_at as string,
      ...(row.p_revoked_at ? { revokedAt: row.p_revoked_at as string } : {}),
    };
  }

  private static readonly KEY_SELECT = `SELECT k.id AS key_id, k.key_hash, k.key_prefix, k.rate_per_min, k.rate_per_day,
    k.created_at AS k_created_at, k.revoked_at AS k_revoked_at, k.last_used_at,
    p.id AS p_id, p.name AS p_name, p.scopes AS p_scopes, p.created_at AS p_created_at, p.revoked_at AS p_revoked_at
    FROM api_keys k JOIN principals p ON p.id = k.principal_id`;

  private rowToKey(row: Row): KeyRecord {
    return {
      keyId: row.key_id as string,
      keyHash: row.key_hash as string,
      keyPrefix: row.key_prefix as string,
      ratePerMin: (row.rate_per_min as number | null) ?? null,
      ratePerDay: (row.rate_per_day as number | null) ?? null,
      createdAt: row.k_created_at as string,
      revokedAt: (row.k_revoked_at as string | null) ?? null,
      lastUsedAt: (row.last_used_at as string | null) ?? null,
      principal: this.rowToPrincipal(row),
    };
  }

  createPrincipalWithKey(principal: Principal, key: NewKey): void {
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO principals (id, name, scopes, created_at) VALUES (?, ?, ?, ?)")
        .run(principal.id, principal.name, j(principal.scopes), principal.createdAt);
      this.db
        .prepare(
          `INSERT INTO api_keys (id, principal_id, key_hash, key_prefix, rate_per_min, rate_per_day, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(key.keyId, principal.id, key.keyHash, key.keyPrefix, key.ratePerMin ?? null, key.ratePerDay ?? null, principal.createdAt);
    })();
  }

  findKeysByPrefix(prefix: string): KeyRecord[] {
    return (this.db.prepare(`${SqliteRepository.KEY_SELECT} WHERE k.key_prefix = ?`).all(prefix) as Row[]).map((r) => this.rowToKey(r));
  }

  revokeKey(keyId: string, at: Date): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT principal_id, revoked_at FROM api_keys WHERE id = ?").get(keyId) as
        | { principal_id: string; revoked_at: string | null }
        | undefined;
      if (!row) return false;
      const iso = at.toISOString();
      this.db.prepare("UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(iso, keyId);
      this.db.prepare("UPDATE principals SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(iso, row.principal_id);
      return true;
    })();
  }

  listKeys(): KeyRecord[] {
    return (this.db.prepare(`${SqliteRepository.KEY_SELECT} ORDER BY k.created_at ASC, k.id ASC`).all() as Row[]).map((r) =>
      this.rowToKey(r),
    );
  }

  touchKey(keyId: string, at: Date): void {
    this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(at.toISOString(), keyId);
  }

  getPrincipal(id: string): Principal | null {
    const row = this.db
      .prepare("SELECT id AS p_id, name AS p_name, scopes AS p_scopes, created_at AS p_created_at, revoked_at AS p_revoked_at FROM principals WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? this.rowToPrincipal(row) : null;
  }

  incrementWindow(principalId: string, window: "min" | "day", bucket: number): number {
    const row = this.db
      .prepare(
        `INSERT INTO rate_limit_state (principal_id, window, bucket, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(principal_id, window, bucket) DO UPDATE SET count = count + 1 RETURNING count`,
      )
      .get(principalId, window, bucket) as { count: number };
    return row.count;
  }

  pruneWindows(minBucketBefore: number, dayBucketBefore: number): void {
    this.db.prepare("DELETE FROM rate_limit_state WHERE window = 'min' AND bucket < ?").run(minBucketBefore);
    this.db.prepare("DELETE FROM rate_limit_state WHERE window = 'day' AND bucket < ?").run(dayBucketBefore);
  }

  // ---------- oauth ----------

  upsertConnection(row: OAuthConnectionRow): void {
    this.db
      .prepare(
        `INSERT INTO oauth_connections (principal_id, source, access_token_enc, refresh_token_enc, expires_at, scope, created_at, updated_at)
         VALUES (@principalId, @source, @accessTokenEnc, @refreshTokenEnc, @expiresAt, @scope, @createdAt, @updatedAt)
         ON CONFLICT(principal_id, source) DO UPDATE SET access_token_enc=excluded.access_token_enc,
           refresh_token_enc=excluded.refresh_token_enc, expires_at=excluded.expires_at, scope=excluded.scope,
           updated_at=excluded.updated_at`,
      )
      .run(row);
  }

  getConnection(principalId: string, source: string): OAuthConnectionRow | null {
    const r = this.db
      .prepare("SELECT * FROM oauth_connections WHERE principal_id = ? AND source = ?")
      .get(principalId, source) as Row | undefined;
    if (!r) return null;
    return {
      principalId: r.principal_id as string,
      source: r.source as string,
      accessTokenEnc: r.access_token_enc as string,
      refreshTokenEnc: (r.refresh_token_enc as string | null) ?? null,
      expiresAt: (r.expires_at as string | null) ?? null,
      scope: (r.scope as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  deleteConnection(principalId: string, source: string): boolean {
    return this.db.prepare("DELETE FROM oauth_connections WHERE principal_id = ? AND source = ?").run(principalId, source).changes > 0;
  }

  saveOAuthState(stateHash: string, principalId: string, source: string, expiresAt: Date): void {
    this.db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(new Date().toISOString());
    this.db
      .prepare("INSERT INTO oauth_states (state_hash, principal_id, source, expires_at) VALUES (?, ?, ?, ?)")
      .run(stateHash, principalId, source, expiresAt.toISOString());
  }

  consumeOAuthState(stateHash: string, now: Date): { principalId: string; source: string } | null {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT principal_id, source, expires_at FROM oauth_states WHERE state_hash = ?").get(stateHash) as
        | { principal_id: string; source: string; expires_at: string }
        | undefined;
      if (!row) return null;
      this.db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").run(stateHash);
      if (row.expires_at <= now.toISOString()) return null;
      return { principalId: row.principal_id, source: row.source };
    })();
  }

  // ---------- collections ----------

  createCollection(c: Collection): void {
    this.db
      .prepare("INSERT INTO collections (id, owner_principal_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run(c.id, c.ownerPrincipalId, c.name, c.createdAt);
  }

  getCollection(id: string): Collection | null {
    const r = this.db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as Row | undefined;
    return r
      ? { id: r.id as string, ownerPrincipalId: r.owner_principal_id as string, name: r.name as string, createdAt: r.created_at as string }
      : null;
  }

  listCollections(ownerPrincipalId: string): Array<Collection & { itemCount: number }> {
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS n
         FROM collections c WHERE c.owner_principal_id = ? ORDER BY c.created_at ASC, c.id ASC`,
      )
      .all(ownerPrincipalId) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      ownerPrincipalId: r.owner_principal_id as string,
      name: r.name as string,
      createdAt: r.created_at as string,
      itemCount: r.n as number,
    }));
  }

  addCollectionItem(collectionId: string, designId: string, at: Date): boolean {
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO collection_items (collection_id, design_id, added_at) VALUES (?, ?, ?)")
        .run(collectionId, designId, at.toISOString()).changes > 0
    );
  }

  collectionDesignIds(collectionId: string): string[] {
    return (
      this.db.prepare("SELECT design_id FROM collection_items WHERE collection_id = ? ORDER BY added_at ASC, design_id ASC").all(collectionId) as Array<{
        design_id: string;
      }>
    ).map((r) => r.design_id);
  }

  // ---------- ops ----------

  appendAudit(event: string, principalId: string | null, details: Record<string, unknown>, at: Date): void {
    this.db
      .prepare("INSERT INTO audit_log (ts, event, principal_id, details) VALUES (?, ?, ?, ?)")
      .run(at.toISOString(), event, principalId, j(details));
  }

  listAudit(opts: { event?: string; limit: number }): AuditEntry[] {
    const rows = (
      opts.event
        ? this.db.prepare("SELECT * FROM audit_log WHERE event = ? ORDER BY id DESC LIMIT ?").all(opts.event, opts.limit)
        : this.db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(opts.limit)
    ) as Row[];
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      event: r.event as string,
      principalId: (r.principal_id as string | null) ?? null,
      details: r.details ? (JSON.parse(r.details as string) as Record<string, unknown>) : {},
    }));
  }

  addAnalysisUsage(day: string, usage: { costUsd: number; inputTokens: number; outputTokens: number }): void {
    this.db
      .prepare(
        `INSERT INTO analysis_usage (day, cost_usd, input_tokens, output_tokens, calls) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(day) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd,
           input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
           calls = calls + 1`,
      )
      .run(day, usage.costUsd, usage.inputTokens, usage.outputTokens);
  }

  getAnalysisUsage(day: string): { costUsd: number; inputTokens: number; outputTokens: number; calls: number } {
    const r = this.db.prepare("SELECT * FROM analysis_usage WHERE day = ?").get(day) as Row | undefined;
    return r
      ? { costUsd: r.cost_usd as number, inputTokens: r.input_tokens as number, outputTokens: r.output_tokens as number, calls: r.calls as number }
      : { costUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
  }

  ping(): boolean {
    try {
      return (this.db.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1;
    } catch {
      return false;
    }
  }

  async backupTo(path: string): Promise<void> {
    mkdirSync(dirname(path), { recursive: true });
    await this.db.backup(path);
  }

  close(): void {
    this.db.close();
  }
}

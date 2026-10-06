import type { Design, DesignAnalysis } from "../sources/types.js";
import type { Principal, Scope } from "../auth/scopes.js";

/**
 * Storage seam. SQLite implements it in v1; a Postgres implementation can replace it
 * without touching services or tools.
 */

export interface DesignWriteOptions {
  /** Principal whose private data this is (USER_OAUTH sources). Null/undefined = shared. */
  ownerPrincipalId?: string | null;
  submittedBy?: string | null;
}

export interface ViewerContext {
  principalId: string;
  now: Date;
}

export interface ScoredDesign {
  design: Design;
  /** Positive, higher is better (negated FTS5 bm25). */
  score: number;
}

export interface KeyRecord {
  keyId: string;
  keyHash: string;
  keyPrefix: string;
  ratePerMin: number | null;
  ratePerDay: number | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  principal: Principal;
}

export interface NewKey {
  keyId: string;
  keyHash: string;
  keyPrefix: string;
  ratePerMin?: number;
  ratePerDay?: number;
}

export interface OAuthConnectionRow {
  principalId: string;
  source: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: string | null;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  ownerPrincipalId: string;
  name: string;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  event: string;
  principalId: string | null;
  details: Record<string, unknown>;
}

export interface SourceCacheEntry {
  designIds: string[];
  totalEstimate: number | null;
}

export interface DesignRepository {
  upsertDesign(design: Design, opts?: DesignWriteOptions): void;
  getDesign(id: string, viewer: ViewerContext): Design | null;
  /** Full-text candidates ordered best-first. Rows are visible to the viewer only. */
  searchByTerms(
    terms: string[],
    opts: { sources?: string[]; limit: number; viewer: ViewerContext },
  ): ScoredDesign[];
  /** Candidates sharing category/tags/platform for similarity ranking. */
  similarityCandidates(
    seed: Design,
    opts: { sources?: string[]; limit: number; viewer: ViewerContext },
  ): Design[];
  countDesigns(source?: string): number;
  /** Returns true if a model analysis was stored (never overwrites owner analysis). */
  setModelAnalysis(id: string, analysis: DesignAnalysis): boolean;
  setOwnerAnalysis(id: string, analysis: DesignAnalysis): boolean;
  markAnalysisFailed(id: string, at: Date): void;
  listNeedingAnalysis(opts: { sources: string[]; limit: number; now: Date }): Design[];
  deleteDesign(id: string): boolean;
  /** Removes every design, cache entry and analysis from one source. */
  purgeSource(source: string): number;
  purgeExpired(now: Date): number;
  /** Removes a user's private cached data for one source. */
  purgePrincipalSource(principalId: string, source: string): number;
  getSourceCache(key: string, now: Date): SourceCacheEntry | null;
  putSourceCache(
    key: string,
    source: string,
    principalId: string,
    entry: SourceCacheEntry,
    expiresAt: Date,
  ): void;
}

export interface AuthRepository {
  createPrincipalWithKey(principal: Principal, key: NewKey): void;
  findKeysByPrefix(prefix: string): KeyRecord[];
  revokeKey(keyId: string, at: Date): boolean;
  listKeys(): KeyRecord[];
  touchKey(keyId: string, at: Date): void;
  getPrincipal(id: string): Principal | null;
  incrementWindow(principalId: string, window: "min" | "day", bucket: number): number;
  pruneWindows(minBucketBefore: number, dayBucketBefore: number): void;
}

export interface ConnectionRepository {
  upsertConnection(row: OAuthConnectionRow): void;
  getConnection(principalId: string, source: string): OAuthConnectionRow | null;
  deleteConnection(principalId: string, source: string): boolean;
  saveOAuthState(stateHash: string, principalId: string, source: string, expiresAt: Date): void;
  /** Single use: returns and deletes the state if unexpired. */
  consumeOAuthState(stateHash: string, now: Date): { principalId: string; source: string } | null;
}

export interface CollectionRepository {
  createCollection(c: Collection): void;
  getCollection(id: string): Collection | null;
  listCollections(ownerPrincipalId: string): Array<Collection & { itemCount: number }>;
  addCollectionItem(collectionId: string, designId: string, at: Date): boolean;
  collectionDesignIds(collectionId: string): string[];
}

export interface OpsRepository {
  appendAudit(event: string, principalId: string | null, details: Record<string, unknown>, at: Date): void;
  listAudit(opts: { event?: string; limit: number }): AuditEntry[];
  addAnalysisUsage(day: string, usage: { costUsd: number; inputTokens: number; outputTokens: number }): void;
  getAnalysisUsage(day: string): {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
  };
  ping(): boolean;
  backupTo(path: string): Promise<void>;
  close(): void;
}

export type Repository = DesignRepository &
  AuthRepository &
  ConnectionRepository &
  CollectionRepository &
  OpsRepository;

export type { Principal, Scope };

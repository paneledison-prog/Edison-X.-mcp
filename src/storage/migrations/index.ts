/** Forward-only, numbered migrations. Never edit an applied migration; add a new one. */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE designs (
  rid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  image_url TEXT,
  thumbnail_url TEXT,
  creator_name TEXT,
  creator_url TEXT,
  license TEXT,
  attribution TEXT NOT NULL,
  platform TEXT NOT NULL,
  category TEXT,
  tags TEXT NOT NULL,
  palette TEXT,
  summary TEXT,
  analysis TEXT,
  analysis_by TEXT,
  owner_principal_id TEXT,
  submitted_by TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX idx_designs_source ON designs(source);
CREATE INDEX idx_designs_expires ON designs(expires_at);
CREATE INDEX idx_designs_owner ON designs(owner_principal_id);
CREATE INDEX idx_designs_source_url ON designs(source_url);

CREATE VIRTUAL TABLE designs_fts USING fts5(
  title, tags, summary, analysis_text, category,
  tokenize = 'porter unicode61'
);

CREATE TABLE principals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  rate_per_min INTEGER,
  rate_per_day INTEGER,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

CREATE TABLE oauth_connections (
  principal_id TEXT NOT NULL,
  source TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at TEXT,
  scope TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, source)
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  source TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  owner_principal_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_collections_owner ON collections(owner_principal_id);

CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  design_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, design_id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  principal_id TEXT,
  details TEXT
);
CREATE INDEX idx_audit_event ON audit_log(event, ts);

CREATE TABLE rate_limit_state (
  principal_id TEXT NOT NULL,
  window TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (principal_id, window, bucket)
);

CREATE TABLE source_cache (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  design_ids TEXT NOT NULL,
  total_estimate INTEGER,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_source_cache_source ON source_cache(source);

CREATE TABLE analysis_usage (
  day TEXT PRIMARY KEY,
  cost_usd REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  calls INTEGER NOT NULL
);
`,
  },
  {
    id: 2,
    name: "analysis_failure_tracking",
    sql: `ALTER TABLE designs ADD COLUMN analysis_failed_at TEXT;`,
  },
];

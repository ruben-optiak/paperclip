CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_publications (
  idempotency_key TEXT PRIMARY KEY,
  batch_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  source_revision_sha256 TEXT NOT NULL,
  draft_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'creating', 'succeeded', 'failed', 'uncertain')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  linear_identifier TEXT,
  linear_url TEXT,
  error_code TEXT,
  operator_evidence_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ticket_publications_status_idx
  ON ticket_publications(status, updated_at);

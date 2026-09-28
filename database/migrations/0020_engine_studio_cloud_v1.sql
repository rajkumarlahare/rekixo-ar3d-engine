-- Phase 4: authenticated Engine Studio cloud drafts and project-scoped assets.
-- Engine-only. The stable Rekixo AR3D Platform/Super Admin is not modified.

CREATE TABLE IF NOT EXISTS studio_drafts_3d (
  project_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  draft_json TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS studio_assets_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('model','reference','source','texture','other')),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
  orphaned_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  UNIQUE (project_id, id)
);

CREATE INDEX IF NOT EXISTS idx_studio_assets_3d_project
  ON studio_assets_3d(project_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_studio_assets_3d_orphan
  ON studio_assets_3d(project_id, ref_count, orphaned_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS engine_admin_security (
  id TEXT PRIMARY KEY,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO engine_admin_security (id, session_version)
VALUES ('owner', 1);

CREATE TABLE IF NOT EXISTS engine_admin_audit (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  project_id TEXT,
  target_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_engine_admin_audit_created
  ON engine_admin_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engine_admin_audit_project
  ON engine_admin_audit(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS engine_admin_login_attempts (
  attempt_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_start INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engine_admin_login_attempts_window
  ON engine_admin_login_attempts(window_start);

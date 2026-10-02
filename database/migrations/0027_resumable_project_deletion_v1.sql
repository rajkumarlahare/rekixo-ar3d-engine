-- Phase 8.2: resumable Engine project deletion lifecycle.
-- Engine-only. This table deliberately has no project FK so cleanup can resume
-- after project records are removed or a prior attempt is interrupted.

CREATE TABLE IF NOT EXISTS engine_deletion_jobs_3d (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('all-projects')),
  status TEXT NOT NULL
    CHECK (status IN ('running','cleanup_pending','db_cleanup_pending','completed')),
  actor_email TEXT NOT NULL,
  expected_project_count INTEGER NOT NULL CHECK (expected_project_count >= 0),
  projects_json TEXT NOT NULL,
  deleted_projects INTEGER NOT NULL DEFAULT 0 CHECK (deleted_projects >= 0),
  deleted_r2_objects INTEGER NOT NULL DEFAULT 0 CHECK (deleted_r2_objects >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_deletion_jobs_3d_one_active
  ON engine_deletion_jobs_3d(kind)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS idx_engine_deletion_jobs_3d_status
  ON engine_deletion_jobs_3d(status, updated_at DESC);

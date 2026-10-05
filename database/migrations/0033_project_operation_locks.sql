-- Generic operational locks for project-scoped admin mutations.
-- Runtime code checks project_id + operation and remains tenant-neutral.
-- Project-specific protection policy lives in data/migrations, not generic workers.

CREATE TABLE IF NOT EXISTS project_operation_locks_3d (
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL
    CHECK (length(operation) BETWEEN 1 AND 80),
  reason TEXT NOT NULL
    CHECK (length(reason) BETWEEN 1 AND 500),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, operation),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_operation_locks_3d_operation
  ON project_operation_locks_3d(operation, project_id);

-- Preserve the current golden production benchmark without teaching generic
-- runtime code any tenant identity. This row can later be retired explicitly
-- once the benchmark lock is no longer required.
INSERT OR IGNORE INTO project_operation_locks_3d
  (project_id, operation, reason, created_by)
SELECT
  id,
  'source-write',
  'Golden production benchmark source originals are locked during the automatic-presentation migration.',
  'system:phase4'
FROM projects_3d
WHERE slug='jyoti-paradise';

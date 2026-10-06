-- Durable V2 processing spine for sealed Source Pack inputs.
-- Additive only. This migration does not run model conversion, modify source bytes,
-- switch Building/Geo releases, or change the public runtime.

CREATE TABLE IF NOT EXISTS processing_jobs_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_pack_id TEXT NOT NULL,
  source_pack_version INTEGER NOT NULL CHECK (source_pack_version >= 1),
  source_pack_manifest_sha256 TEXT NOT NULL
    CHECK (length(source_pack_manifest_sha256) = 64),
  processor_version TEXT NOT NULL
    CHECK (length(processor_version) BETWEEN 1 AND 120),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
  artifact_prefix TEXT NOT NULL CHECK (length(artifact_prefix) BETWEEN 1 AND 700),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  heartbeat_at TEXT,
  finished_at TEXT,
  failure_code TEXT,
  failure_reason TEXT,
  output_manifest_json TEXT
    CHECK (output_manifest_json IS NULL OR json_valid(output_manifest_json)),
  output_manifest_sha256 TEXT
    CHECK (output_manifest_sha256 IS NULL OR length(output_manifest_sha256) = 64),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_pack_id) REFERENCES source_packs_3d(id) ON DELETE CASCADE,
  -- source_pack_id is the ownership cascade. project_id remains an isolation
  -- assertion without introducing a second project -> job cascade path.
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE NO ACTION,
  UNIQUE (source_pack_id, processor_version, attempt),
  UNIQUE (project_id, id),
  CHECK (
    state != 'succeeded'
    OR (
      finished_at IS NOT NULL
      AND output_manifest_json IS NOT NULL
      AND output_manifest_sha256 IS NOT NULL
    )
  ),
  CHECK (state NOT IN ('failed','cancelled') OR finished_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_3d_project
  ON processing_jobs_3d(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_3d_pack
  ON processing_jobs_3d(source_pack_id, processor_version, attempt DESC);

-- There can be only one active-or-complete canonical attempt for an immutable
-- Source Pack + processor version. Failed/cancelled attempts remain history and
-- a retry receives a new attempt number rather than overwriting old state.
CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_jobs_3d_single_live
  ON processing_jobs_3d(source_pack_id, processor_version)
  WHERE state IN ('queued','running','succeeded');

-- A job can only pin an operator-approved immutable Source Pack snapshot. Ready
-- may later become superseded when a newer pack is sealed; both states remain
-- immutable sealed inputs and therefore preserve the exact processing identity.
-- The artifact prefix is derived here as a database invariant instead of trusting
-- an API caller to choose a project/storage namespace correctly.
CREATE TRIGGER IF NOT EXISTS trg_processing_jobs_3d_input_insert
BEFORE INSERT ON processing_jobs_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM source_packs_3d p
    JOIN projects_3d project ON project.id=p.project_id
   WHERE p.id=NEW.source_pack_id
     AND p.project_id=NEW.project_id
     AND p.version=NEW.source_pack_version
     AND p.status IN ('ready','superseded')
     AND p.operator_approved=1
     AND p.manifest_sha256=NEW.source_pack_manifest_sha256
     AND NEW.artifact_prefix =
       'projects/' || project.slug || '/processing/' || NEW.source_pack_id || '/' ||
       NEW.processor_version || '/attempt-' || NEW.attempt || '/'
)
BEGIN
  SELECT RAISE(ABORT, 'Processing job requires the exact sealed Source Pack snapshot and storage boundary');
END;

-- Processing input identity is content-addressed and never changes in-place.
CREATE TRIGGER IF NOT EXISTS trg_processing_jobs_3d_identity_immutable
BEFORE UPDATE OF id,project_id,source_pack_id,source_pack_version,
  source_pack_manifest_sha256,processor_version,attempt,artifact_prefix,
  requested_by,requested_at
ON processing_jobs_3d
BEGIN
  SELECT RAISE(ABORT, 'Processing job input identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_processing_jobs_3d_state_transition
BEFORE UPDATE OF state ON processing_jobs_3d
WHEN NOT (
  (OLD.state='queued' AND NEW.state IN ('queued','running','failed','cancelled'))
  OR (OLD.state='running' AND NEW.state IN ('running','succeeded','failed','cancelled'))
  OR (OLD.state=NEW.state AND OLD.state IN ('succeeded','failed','cancelled'))
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid processing job state transition');
END;

-- Terminal attempt history is append-only. Retry means a new row/attempt.
CREATE TRIGGER IF NOT EXISTS trg_processing_jobs_3d_terminal_immutable
BEFORE UPDATE ON processing_jobs_3d
WHEN OLD.state IN ('succeeded','failed','cancelled')
BEGIN
  SELECT RAISE(ABORT, 'Terminal processing job is immutable; create a retry attempt');
END;

CREATE TABLE IF NOT EXISTS processing_artifacts_3d (
  id TEXT PRIMARY KEY,
  processing_job_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 80),
  logical_id TEXT NOT NULL CHECK (length(logical_id) BETWEEN 1 AND 240),
  state TEXT NOT NULL DEFAULT 'staged'
    CHECK (state IN ('staged','ready','failed')),
  r2_key TEXT NOT NULL UNIQUE CHECK (length(r2_key) BETWEEN 1 AND 900),
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 200),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (processing_job_id) REFERENCES processing_jobs_3d(id) ON DELETE CASCADE,
  -- processing_job_id is the ownership cascade; project_id is an ownership check.
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE NO ACTION,
  UNIQUE (processing_job_id, kind, logical_id),
  UNIQUE (project_id, id),
  CHECK (
    state != 'ready'
    OR (byte_size IS NOT NULL AND sha256 IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_processing_artifacts_3d_job
  ON processing_artifacts_3d(processing_job_id, state, kind, logical_id);
CREATE INDEX IF NOT EXISTS idx_processing_artifacts_3d_project
  ON processing_artifacts_3d(project_id, created_at);

-- Artifacts may only be staged/finalized by the exact running job and inside its
-- attempt-specific storage prefix. Prefix matching uses byte-for-byte substring
-- comparison, not SQL LIKE, so underscores in Source Pack IDs cannot become wildcards.
CREATE TRIGGER IF NOT EXISTS trg_processing_artifacts_3d_owner_insert
BEFORE INSERT ON processing_artifacts_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM processing_jobs_3d j
   WHERE j.id=NEW.processing_job_id
     AND j.project_id=NEW.project_id
     AND j.state='running'
     AND length(NEW.r2_key) > length(j.artifact_prefix)
     AND substr(NEW.r2_key,1,length(j.artifact_prefix))=j.artifact_prefix
)
BEGIN
  SELECT RAISE(ABORT, 'Processing artifact must belong to the running job storage boundary');
END;

CREATE TRIGGER IF NOT EXISTS trg_processing_artifacts_3d_owner_update
BEFORE UPDATE OF processing_job_id,project_id,r2_key ON processing_artifacts_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM processing_jobs_3d j
   WHERE j.id=NEW.processing_job_id
     AND j.project_id=NEW.project_id
     AND j.state='running'
     AND length(NEW.r2_key) > length(j.artifact_prefix)
     AND substr(NEW.r2_key,1,length(j.artifact_prefix))=j.artifact_prefix
)
BEGIN
  SELECT RAISE(ABORT, 'Processing artifact must remain inside the running job storage boundary');
END;

CREATE TRIGGER IF NOT EXISTS trg_processing_artifacts_3d_ready_update_block
BEFORE UPDATE ON processing_artifacts_3d
WHEN OLD.state='ready'
BEGIN
  SELECT RAISE(ABORT, 'Ready processing artifact is immutable');
END;

-- A successful job must have at least one content-addressed ready artifact. Phase
-- 1 only queues jobs; the Phase 2 executor will satisfy this gate before success.
CREATE TRIGGER IF NOT EXISTS trg_processing_jobs_3d_succeeded_requires_artifact
BEFORE UPDATE OF state,output_manifest_json,output_manifest_sha256,finished_at
ON processing_jobs_3d
WHEN NEW.state='succeeded'
 AND NOT EXISTS (
   SELECT 1
     FROM processing_artifacts_3d a
    WHERE a.processing_job_id=NEW.id
      AND a.project_id=NEW.project_id
      AND a.state='ready'
 )
BEGIN
  SELECT RAISE(ABORT, 'Successful processing job requires a ready artifact');
END;

-- Successful processing history and ready artifacts may disappear only through
-- the exact database-cleanup stage of the resumable whole-project deletion job.
-- The archived status is read from that immutable deletion snapshot because the
-- projects_3d parent row may already be disappearing when child cascades fire.
CREATE TRIGGER IF NOT EXISTS trg_processing_jobs_3d_succeeded_delete_block
BEFORE DELETE ON processing_jobs_3d
WHEN OLD.state='succeeded'
 AND NOT EXISTS (
   SELECT 1
     FROM engine_deletion_jobs_3d job,
          json_each(job.projects_json) snapshot_project
    WHERE job.kind='all-projects'
      AND job.status='db_cleanup_pending'
      AND json_extract(snapshot_project.value, '$.id')=OLD.project_id
      AND json_extract(snapshot_project.value, '$.status')='archived'
 )
BEGIN
  SELECT RAISE(ABORT, 'Successful processing job is immutable outside project hard delete');
END;

CREATE TRIGGER IF NOT EXISTS trg_processing_artifacts_3d_ready_delete_block
BEFORE DELETE ON processing_artifacts_3d
WHEN OLD.state='ready'
 AND NOT EXISTS (
   SELECT 1
     FROM engine_deletion_jobs_3d job,
          json_each(job.projects_json) snapshot_project
    WHERE job.kind='all-projects'
      AND job.status='db_cleanup_pending'
      AND json_extract(snapshot_project.value, '$.id')=OLD.project_id
      AND json_extract(snapshot_project.value, '$.status')='archived'
 )
BEGIN
  SELECT RAISE(ABORT, 'Ready processing artifact is immutable outside project hard delete');
END;

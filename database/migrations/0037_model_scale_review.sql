-- Durable operator review for suspicious FBX metric normalization.
-- Additive only. A failed canonical-processing attempt may record the exact
-- processor diagnostic; an operator may approve one explicit metres-per-source-
-- unit decision, and the next retry can consume that immutable decision.

CREATE TABLE IF NOT EXISTS model_scale_reviews_3d (
  id TEXT PRIMARY KEY,
  processing_job_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  source_pack_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256)=64),
  diagnostic_json TEXT NOT NULL
    CHECK (json_valid(diagnostic_json) AND json_type(diagnostic_json)='object'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved')),
  metres_per_source_unit REAL,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (processing_job_id) REFERENCES processing_jobs_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE NO ACTION,
  FOREIGN KEY (source_pack_id) REFERENCES source_packs_3d(id) ON DELETE NO ACTION,
  FOREIGN KEY (source_file_id) REFERENCES source_files_3d(id) ON DELETE NO ACTION,
  CHECK (
    status!='approved'
    OR (
      metres_per_source_unit IS NOT NULL
      AND metres_per_source_unit >= 0.000001
      AND metres_per_source_unit <= 1000000
      AND approved_by IS NOT NULL
      AND approved_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_model_scale_reviews_3d_source
  ON model_scale_reviews_3d(project_id,source_pack_id,source_file_id,created_at DESC);

-- Only the exact running FBX processing attempt may create a review record for
-- its sealed geometry authority. This prevents an API caller from inventing
-- source identity or attaching a decision to another project.
CREATE TRIGGER IF NOT EXISTS trg_model_scale_reviews_3d_owner_insert
BEFORE INSERT ON model_scale_reviews_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM processing_jobs_3d job
    JOIN source_packs_3d pack
      ON pack.id=job.source_pack_id
     AND pack.project_id=job.project_id
    JOIN source_files_3d source
      ON source.id=pack.geometry_authority_file_id
     AND source.project_id=job.project_id
   WHERE job.id=NEW.processing_job_id
     AND job.project_id=NEW.project_id
     AND job.source_pack_id=NEW.source_pack_id
     AND job.state='running'
     AND source.id=NEW.source_file_id
     AND source.sha256=NEW.source_sha256
     AND lower(source.filename) LIKE '%.fbx'
)
BEGIN
  SELECT RAISE(ABORT, 'Scale review must belong to the running FBX geometry-authority attempt');
END;

-- Review identity and processor diagnostic are append-only. Operator approval
-- may only fill the explicit scale and reviewer fields on a pending review.
CREATE TRIGGER IF NOT EXISTS trg_model_scale_reviews_3d_identity_immutable
BEFORE UPDATE OF id,processing_job_id,project_id,source_pack_id,source_file_id,
  source_sha256,diagnostic_json,created_at
ON model_scale_reviews_3d
BEGIN
  SELECT RAISE(ABORT, 'Scale review identity and diagnostic are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_model_scale_reviews_3d_transition
BEFORE UPDATE OF status,metres_per_source_unit,approved_by,approved_at
ON model_scale_reviews_3d
WHEN NOT (
  OLD.status='pending'
  AND NEW.status='approved'
  AND NEW.metres_per_source_unit IS NOT NULL
  AND NEW.metres_per_source_unit >= 0.000001
  AND NEW.metres_per_source_unit <= 1000000
  AND NEW.approved_by IS NOT NULL
  AND NEW.approved_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Scale review may only transition once from pending to approved');
END;

CREATE TRIGGER IF NOT EXISTS trg_model_scale_reviews_3d_approved_immutable
BEFORE UPDATE ON model_scale_reviews_3d
WHEN OLD.status='approved'
BEGIN
  SELECT RAISE(ABORT, 'Approved scale review is immutable');
END;

-- Source Pack V2 foundation for the Automatic Presentation Engine.
-- Additive only. Legacy Studio assets/drafts remain untouched while the new source
-- ingestion path is introduced behind dedicated contracts and later APIs.

CREATE TABLE IF NOT EXISTS source_files_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  r2_key TEXT NOT NULL UNIQUE,
  upload_state TEXT NOT NULL DEFAULT 'registered'
    CHECK (upload_state IN ('registered','uploading','uploaded','verified','failed')),
  source_etag TEXT,
  failure_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  UNIQUE (project_id, id)
);

CREATE INDEX IF NOT EXISTS idx_source_files_3d_project
  ON source_files_3d(project_id, upload_state, created_at);
CREATE INDEX IF NOT EXISTS idx_source_files_3d_sha256
  ON source_files_3d(project_id, sha256);

-- Once an original has been verified, its identity/content address is immutable.
CREATE TRIGGER IF NOT EXISTS trg_source_files_3d_verified_identity_immutable
BEFORE UPDATE OF project_id,filename,media_type,byte_size,sha256,r2_key
ON source_files_3d
WHEN OLD.upload_state='verified'
BEGIN
  SELECT RAISE(ABORT, 'Verified source file identity is immutable');
END;

CREATE TABLE IF NOT EXISTS source_packs_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','superseded','failed')),
  geometry_authority_file_id TEXT,
  operator_approved INTEGER NOT NULL DEFAULT 0 CHECK (operator_approved IN (0,1)),
  manifest_json TEXT,
  manifest_sha256 TEXT CHECK (manifest_sha256 IS NULL OR length(manifest_sha256) = 64),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  -- NO ACTION is intentional: deleting a source file alone is blocked, while a
  -- whole-project delete may remove the pack and its authority in one statement.
  FOREIGN KEY (geometry_authority_file_id) REFERENCES source_files_3d(id) ON DELETE NO ACTION,
  UNIQUE (project_id, version),
  UNIQUE (project_id, id),
  CHECK (
    status!='ready'
    OR (
      geometry_authority_file_id IS NOT NULL
      AND operator_approved=1
      AND manifest_json IS NOT NULL
      AND manifest_sha256 IS NOT NULL
      AND approved_by IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_source_packs_3d_project_version
  ON source_packs_3d(project_id, version DESC);

CREATE TABLE IF NOT EXISTS source_pack_files_3d (
  source_pack_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  roles_json TEXT NOT NULL
    CHECK (json_valid(roles_json) AND json_type(roles_json)='array'),
  capabilities_json TEXT NOT NULL
    CHECK (json_valid(capabilities_json) AND json_type(capabilities_json)='array'),
  classification_origin TEXT NOT NULL
    CHECK (classification_origin IN ('automatic','operator')),
  classification_confidence REAL NOT NULL
    CHECK (classification_confidence >= 0 AND classification_confidence <= 1),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_pack_id, source_file_id),
  FOREIGN KEY (source_pack_id) REFERENCES source_packs_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  -- Like the authority FK above, NO ACTION protects ordinary source deletion but
  -- permits a single whole-project cascade once every referencing row disappears.
  FOREIGN KEY (source_file_id) REFERENCES source_files_3d(id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_source_pack_files_3d_project
  ON source_pack_files_3d(project_id, source_pack_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_source_pack_files_3d_file
  ON source_pack_files_3d(source_file_id);

CREATE TRIGGER IF NOT EXISTS trg_source_pack_files_3d_owner_insert
BEFORE INSERT ON source_pack_files_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM source_packs_3d p
    JOIN source_files_3d f
      ON f.id=NEW.source_file_id
     AND f.project_id=NEW.project_id
   WHERE p.id=NEW.source_pack_id
     AND p.project_id=NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Source pack file must belong to the same project');
END;

CREATE TRIGGER IF NOT EXISTS trg_source_pack_files_3d_owner_update
BEFORE UPDATE OF source_pack_id,project_id,source_file_id ON source_pack_files_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM source_packs_3d p
    JOIN source_files_3d f
      ON f.id=NEW.source_file_id
     AND f.project_id=NEW.project_id
   WHERE p.id=NEW.source_pack_id
     AND p.project_id=NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Source pack file must belong to the same project');
END;

-- Even while a pack is still editable, it cannot contain two equal geometry
-- authorities. Evidence/material/reference files remain supporting inputs only.
CREATE TRIGGER IF NOT EXISTS trg_source_pack_files_3d_single_geometry_insert
BEFORE INSERT ON source_pack_files_3d
WHEN instr(NEW.roles_json, '"geometry-authority"') > 0
 AND EXISTS (
   SELECT 1 FROM source_pack_files_3d existing
    WHERE existing.source_pack_id=NEW.source_pack_id
      AND existing.source_file_id!=NEW.source_file_id
      AND instr(existing.roles_json, '"geometry-authority"') > 0
 )
BEGIN
  SELECT RAISE(ABORT, 'Source pack can contain only one geometry authority');
END;

CREATE TRIGGER IF NOT EXISTS trg_source_pack_files_3d_single_geometry_update
BEFORE UPDATE OF source_pack_id,source_file_id,roles_json ON source_pack_files_3d
WHEN instr(NEW.roles_json, '"geometry-authority"') > 0
 AND EXISTS (
   SELECT 1 FROM source_pack_files_3d existing
    WHERE existing.source_pack_id=NEW.source_pack_id
      AND existing.source_file_id!=NEW.source_file_id
      AND instr(existing.roles_json, '"geometry-authority"') > 0
 )
BEGIN
  SELECT RAISE(ABORT, 'Source pack can contain only one geometry authority');
END;

-- A sealed pack stays immutable after publication of its source decision, even
-- after it is marked superseded by a later pack version.
CREATE TRIGGER IF NOT EXISTS trg_source_pack_files_3d_ready_insert_block
BEFORE INSERT ON source_pack_files_3d
WHEN EXISTS (
  SELECT 1 FROM source_packs_3d p
   WHERE p.id=NEW.source_pack_id AND p.status IN ('ready','superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'Ready source pack file mapping is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_source_pack_files_3d_ready_update_block
BEFORE UPDATE ON source_pack_files_3d
WHEN EXISTS (
  SELECT 1 FROM source_packs_3d p
   WHERE p.id=OLD.source_pack_id AND p.status IN ('ready','superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'Ready source pack file mapping is immutable');
END;

-- Sealed mappings may disappear only as part of the existing resumable hard-delete
-- lifecycle: the project must already be archived and its exact id must be present
-- in the active deletion-job snapshot. Normal edits/deletes remain fail-closed.
CREATE TRIGGER IF NOT EXISTS trg_source_pack_files_3d_ready_delete_block
BEFORE DELETE ON source_pack_files_3d
WHEN EXISTS (
  SELECT 1 FROM source_packs_3d p
   WHERE p.id=OLD.source_pack_id AND p.status IN ('ready','superseded')
)
 AND NOT (
   EXISTS (
     SELECT 1 FROM projects_3d project
      WHERE project.id=OLD.project_id
        AND project.status='archived'
   )
   AND EXISTS (
     SELECT 1
       FROM engine_deletion_jobs_3d job,
            json_each(job.projects_json) snapshot_project
      WHERE job.kind='all-projects'
        AND job.status<>'completed'
        AND json_extract(snapshot_project.value, '$.id')=OLD.project_id
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'Ready source pack file mapping is immutable');
END;

-- A pack is created as draft, its file mappings are attached, then it may be
-- sealed ready. Direct ready inserts fail closed because no child mapping can
-- legitimately pre-exist its parent pack.
CREATE TRIGGER IF NOT EXISTS trg_source_packs_3d_ready_insert
BEFORE INSERT ON source_packs_3d
WHEN NEW.status='ready'
BEGIN
  SELECT RAISE(ABORT, 'Create source pack as draft before sealing it ready');
END;

-- A geometry authority must be a verified original from the same project and
-- must be mapped into this pack with the explicit geometry-authority role.
CREATE TRIGGER IF NOT EXISTS trg_source_packs_3d_ready_update
BEFORE UPDATE OF status,geometry_authority_file_id,operator_approved,manifest_json,manifest_sha256,approved_by
ON source_packs_3d
WHEN NEW.status='ready'
 AND NOT EXISTS (
   SELECT 1
     FROM source_files_3d f
     JOIN source_pack_files_3d pf
       ON pf.source_file_id=f.id
      AND pf.source_pack_id=NEW.id
      AND pf.project_id=NEW.project_id
    WHERE f.id=NEW.geometry_authority_file_id
      AND f.project_id=NEW.project_id
      AND f.upload_state='verified'
      AND instr(pf.roles_json, '"geometry-authority"') > 0
 )
BEGIN
  SELECT RAISE(ABORT, 'Ready source pack requires one verified geometry authority');
END;

-- Once ready/superseded, pack identity/content stays immutable. A ready pack may
-- only stay ready or transition once to superseded; replacement means new version.
CREATE TRIGGER IF NOT EXISTS trg_source_packs_3d_ready_immutable
BEFORE UPDATE ON source_packs_3d
WHEN OLD.status IN ('ready','superseded')
 AND (
   NEW.id!=OLD.id
   OR NEW.project_id!=OLD.project_id
   OR NEW.version!=OLD.version
   OR COALESCE(NEW.geometry_authority_file_id,'')!=COALESCE(OLD.geometry_authority_file_id,'')
   OR NEW.operator_approved!=OLD.operator_approved
   OR COALESCE(NEW.manifest_json,'')!=COALESCE(OLD.manifest_json,'')
   OR COALESCE(NEW.manifest_sha256,'')!=COALESCE(OLD.manifest_sha256,'')
   OR COALESCE(NEW.approved_by,'')!=COALESCE(OLD.approved_by,'')
   OR (OLD.status='ready' AND NEW.status NOT IN ('ready','superseded'))
   OR (OLD.status='superseded' AND NEW.status!='superseded')
 )
BEGIN
  SELECT RAISE(ABORT, 'Ready source pack is immutable; create a new version');
END;

-- Durable metadata for the later R2 multipart/resumable upload implementation.
-- This migration does not start uploads or expose an API by itself.
CREATE TABLE IF NOT EXISTS source_upload_sessions_3d (
  id TEXT PRIMARY KEY,
  source_file_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'r2-multipart'
    CHECK (provider IN ('r2-multipart')),
  upload_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'initiated'
    CHECK (state IN ('initiated','uploading','completed','aborted','failed')),
  part_size INTEGER NOT NULL CHECK (part_size > 0),
  expires_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_file_id) REFERENCES source_files_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  UNIQUE (source_file_id, upload_id)
);

CREATE INDEX IF NOT EXISTS idx_source_upload_sessions_3d_file
  ON source_upload_sessions_3d(source_file_id, state, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_source_upload_sessions_3d_owner_insert
BEFORE INSERT ON source_upload_sessions_3d
WHEN NOT EXISTS (
  SELECT 1 FROM source_files_3d f
   WHERE f.id=NEW.source_file_id AND f.project_id=NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Source upload session must belong to source file project');
END;

CREATE TRIGGER IF NOT EXISTS trg_source_upload_sessions_3d_owner_update
BEFORE UPDATE OF source_file_id,project_id ON source_upload_sessions_3d
WHEN NOT EXISTS (
  SELECT 1 FROM source_files_3d f
   WHERE f.id=NEW.source_file_id AND f.project_id=NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Source upload session must belong to source file project');
END;

CREATE TABLE IF NOT EXISTS source_upload_parts_3d (
  session_id TEXT NOT NULL,
  part_number INTEGER NOT NULL CHECK (part_number >= 1),
  etag TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, part_number),
  FOREIGN KEY (session_id) REFERENCES source_upload_sessions_3d(id) ON DELETE CASCADE
);
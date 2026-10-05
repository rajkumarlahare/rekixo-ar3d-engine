-- Source Pack V2 deletion hardening.
-- Verified originals and sealed source decisions are immutable during normal
-- operation. The only exception is the existing authenticated/resumable
-- all-project hard-delete lifecycle, identified by its durable project snapshot.

CREATE TRIGGER IF NOT EXISTS trg_source_files_3d_verified_delete_block
BEFORE DELETE ON source_files_3d
WHEN OLD.upload_state='verified'
 AND NOT EXISTS (
   SELECT 1
     FROM engine_deletion_jobs_3d job,
          json_each(job.projects_json) snapshot_project
    WHERE job.kind='all-projects'
      AND job.status IN ('running','cleanup_pending','db_cleanup_pending')
      AND json_extract(snapshot_project.value, '$.id')=OLD.project_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Verified source file is immutable outside project hard delete');
END;

CREATE TRIGGER IF NOT EXISTS trg_source_packs_3d_sealed_delete_block
BEFORE DELETE ON source_packs_3d
WHEN OLD.status IN ('ready','superseded')
 AND NOT EXISTS (
   SELECT 1
     FROM engine_deletion_jobs_3d job,
          json_each(job.projects_json) snapshot_project
    WHERE job.kind='all-projects'
      AND job.status IN ('running','cleanup_pending','db_cleanup_pending')
      AND json_extract(snapshot_project.value, '$.id')=OLD.project_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Sealed source pack is immutable outside project hard delete');
END;
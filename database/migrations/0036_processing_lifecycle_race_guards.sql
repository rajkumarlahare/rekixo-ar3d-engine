-- Close lifecycle races around durable V2 processing.
--
-- The HTTP layer already checks project archive state, processing-write locks,
-- and active whole-project deletion before enqueueing work. Those checks are
-- intentionally duplicated here as database invariants so a request that races
-- with an archive/lock/deletion transition cannot create or recover work after
-- the project has become non-writable.
--
-- RAISE(IGNORE) is used for processing enqueue/claim guards. Existing callers
-- already interpret a zero-change insert/update as a lost race/no-op, so blocked
-- polling recovery stays fail-closed without turning a harmless GET into a 500.

CREATE TRIGGER IF NOT EXISTS trg_processing_jobs_3d_enqueue_writable_project
BEFORE INSERT ON processing_jobs_3d
WHEN
  NOT EXISTS (
    SELECT 1
      FROM projects_3d project
     WHERE project.id=NEW.project_id
       AND project.status<>'archived'
  )
  OR EXISTS (
    SELECT 1
      FROM project_operation_locks_3d lock
     WHERE lock.project_id=NEW.project_id
       AND lock.operation='processing-write'
  )
  OR EXISTS (
    SELECT 1
      FROM engine_deletion_jobs_3d deletion
     WHERE deletion.kind='all-projects'
       AND deletion.status<>'completed'
  )
BEGIN
  SELECT RAISE(IGNORE);
END;

-- claimJob() also uses UPDATE state='running' for stale-runner recovery. Guard
-- both queued -> running and running -> running recovery with the same project
-- lifecycle policy. When blocked, the update changes zero rows and the executor
-- simply does not run.
CREATE TRIGGER IF NOT EXISTS trg_processing_jobs_3d_running_writable_project
BEFORE UPDATE OF state ON processing_jobs_3d
WHEN NEW.state='running'
 AND (
  NOT EXISTS (
    SELECT 1
      FROM projects_3d project
     WHERE project.id=NEW.project_id
       AND project.status<>'archived'
  )
  OR EXISTS (
    SELECT 1
      FROM project_operation_locks_3d lock
     WHERE lock.project_id=NEW.project_id
       AND lock.operation='processing-write'
  )
  OR EXISTS (
    SELECT 1
      FROM engine_deletion_jobs_3d deletion
     WHERE deletion.kind='all-projects'
       AND deletion.status<>'completed'
  )
 )
BEGIN
  SELECT RAISE(IGNORE);
END;

-- Archiving a project while an attempt is queued/running would allow the async
-- executor and lifecycle transition to race over the same project namespace.
-- Make archive wait until processing reaches a terminal state.
CREATE TRIGGER IF NOT EXISTS trg_projects_3d_archive_blocks_active_processing
BEFORE UPDATE OF status ON projects_3d
WHEN NEW.status='archived'
 AND OLD.status<>'archived'
 AND EXISTS (
   SELECT 1
     FROM processing_jobs_3d job
    WHERE job.project_id=OLD.id
      AND job.state IN ('queued','running')
 )
BEGIN
  SELECT RAISE(ABORT, 'Project cannot be archived while processing is active');
END;

-- A processing-write lock is a freeze boundary. Do not allow it to be inserted
-- halfway through an active attempt; the operator must first let that attempt
-- reach a terminal state. Once present, the enqueue/claim guards above prevent
-- any new or stale-recovery execution.
CREATE TRIGGER IF NOT EXISTS trg_project_processing_lock_blocks_active_processing
BEFORE INSERT ON project_operation_locks_3d
WHEN NEW.operation='processing-write'
 AND EXISTS (
   SELECT 1
     FROM processing_jobs_3d job
    WHERE job.project_id=NEW.project_id
      AND job.state IN ('queued','running')
 )
BEGIN
  SELECT RAISE(ABORT, 'Processing-write lock requires processing to be terminal');
END;

-- Whole-project deletion owns the entire Engine namespace. Starting it while a
-- processor is still queued/running could otherwise race R2 cleanup against a
-- derived artifact write. D1 batch semantics roll back the deletion-start batch
-- when this invariant aborts.
CREATE TRIGGER IF NOT EXISTS trg_deletion_job_blocks_active_processing
BEFORE INSERT ON engine_deletion_jobs_3d
WHEN NEW.kind='all-projects'
 AND NEW.status<>'completed'
 AND EXISTS (
   SELECT 1
     FROM processing_jobs_3d job
    WHERE job.state IN ('queued','running')
 )
BEGIN
  SELECT RAISE(ABORT, 'Permanent deletion cannot start while processing is active');
END;

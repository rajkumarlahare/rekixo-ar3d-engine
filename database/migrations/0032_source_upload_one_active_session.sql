-- Source Pack V2 upload concurrency guard.
-- A source file may have at most one initiated/uploading R2 multipart session.
-- Completed/aborted/failed history remains durable and unlimited.

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_upload_sessions_3d_one_active
  ON source_upload_sessions_3d(source_file_id)
  WHERE state IN ('initiated','uploading');

-- Source Pack V2 upload-session hardening.
-- One source file may have only one resumable R2 multipart upload in progress.

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_upload_sessions_3d_one_active
  ON source_upload_sessions_3d(source_file_id)
  WHERE state IN ('initiated','uploading');

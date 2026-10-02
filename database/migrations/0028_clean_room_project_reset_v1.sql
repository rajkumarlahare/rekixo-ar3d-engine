-- Clean-room reset for Rekixo AR3D Engine.
-- Re-triggered after the pre-migration browser gate blocked the first deployment attempt.
-- Removes all project-owned runtime data while preserving Engine authentication,
-- global settings, schema, and migration history.

DELETE FROM geo_experience_active_releases_3d;
DELETE FROM geo_release_activations_3d;
DELETE FROM geo_releases_3d;
DELETE FROM geo_draft_verifications_3d;
DELETE FROM geo_placements_3d;
DELETE FROM geo_experience_drafts_3d;
DELETE FROM experiences_3d;

DELETE FROM release_activations_3d;
DELETE FROM release_assets_3d;
DELETE FROM releases_3d;

DELETE FROM studio_assets_3d;
DELETE FROM studio_drafts_3d;
DELETE FROM publish_versions_3d;
DELETE FROM scenes_3d;
DELETE FROM camera_presets_3d;
DELETE FROM models_3d;

UPDATE projects_3d SET active_release_id=NULL;
DELETE FROM projects_3d;

-- Project-specific audit/deletion history can contain old slugs and source IDs.
DELETE FROM engine_deletion_jobs_3d;
DELETE FROM engine_admin_audit;

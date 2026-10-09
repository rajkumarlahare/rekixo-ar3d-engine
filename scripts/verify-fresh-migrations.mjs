import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const stateDir = path.join(root, ".wrangler", "ci-migration-chain");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const database = "rekixo-3d-production";
const config = "wrangler.infra.jsonc";

fs.rmSync(stateDir, { recursive: true, force: true });
fs.mkdirSync(stateDir, { recursive: true });

function run(args, { capture = false } = {}) {
  const result = spawnSync(npx, ["--no-install", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = capture
      ? `\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
      : "";
    throw new Error(
      `Command failed (${result.status}): ${npx} --no-install ${args.join(" ")}${details}`,
    );
  }
  return result.stdout || "";
}

const localArgs = [
  "--local",
  "--persist-to",
  stateDir,
  "--config",
  config,
];

console.log("Applying the full D1 migration chain to a fresh local database...");
run(["wrangler", "d1", "migrations", "apply", database, ...localArgs]);

console.log("Re-applying migrations to verify the migration ledger is stable...");
run(["wrangler", "d1", "migrations", "apply", database, ...localArgs]);

function executeJson(command) {
  const stdout = run(
    [
      "wrangler",
      "d1",
      "execute",
      database,
      ...localArgs,
      "--command",
      command,
      "--json",
    ],
    { capture: true },
  );
  const payload = JSON.parse(stdout);
  const rows = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.results)) rows.push(...value.results);
    for (const child of Object.values(value)) {
      if (child !== value.results) visit(child);
    }
  };
  visit(payload);
  return rows;
}

const requiredObjects = new Set([
  "projects_3d",
  "studio_drafts_3d",
  "releases_3d",
  "experiences_3d",
  "geo_releases_3d",
  "project_branding_3d",
  "project_branding_logo_versions_3d",
  "project_branding_shares_3d",
  "project_branding_share_versions_3d",
  "trg_project_branding_logo_versions_immutable",
  "trg_project_branding_share_versions_immutable",
  "geo_model_anchors_3d",
  "geo_overlays_3d",
  "geo_control_points_3d",
  "geo_calibration_reports_3d",
  "geo_site_boundaries_3d",
  "source_files_3d",
  "source_packs_3d",
  "source_pack_files_3d",
  "source_upload_sessions_3d",
  "source_upload_parts_3d",
  "processing_jobs_3d",
  "processing_artifacts_3d",
  "engine_deletion_jobs_3d",
  "trg_projects_3d_block_insert_during_delete",
]);

const objectRows = executeJson(
  `SELECT name
     FROM sqlite_master
    WHERE type IN ('table','trigger')
      AND name IN (
        'projects_3d',
        'studio_drafts_3d',
        'releases_3d',
        'experiences_3d',
        'geo_releases_3d',
        'project_branding_3d',
        'project_branding_logo_versions_3d',
        'project_branding_shares_3d',
        'project_branding_share_versions_3d',
        'trg_project_branding_logo_versions_immutable',
        'trg_project_branding_share_versions_immutable',
        'geo_model_anchors_3d',
        'geo_overlays_3d',
        'geo_control_points_3d',
        'geo_calibration_reports_3d',
        'geo_site_boundaries_3d',
        'source_files_3d',
        'source_packs_3d',
        'source_pack_files_3d',
        'source_upload_sessions_3d',
        'source_upload_parts_3d',
        'processing_jobs_3d',
        'processing_artifacts_3d',
        'engine_deletion_jobs_3d',
        'trg_projects_3d_block_insert_during_delete'
      )
    ORDER BY name`,
);
const found = new Set(objectRows.map((row) => row.name));
const missing = [...requiredObjects].filter((name) => !found.has(name));
if (missing.length)
  throw new Error(`Fresh migration chain is missing required schema objects: ${missing.join(", ")}`);

const projectCountRows = executeJson("SELECT COUNT(*) AS total FROM projects_3d");
if (Number(projectCountRows[0]?.total ?? -1) !== 0)
  throw new Error("Fresh migration chain must start with an empty project registry.");

console.log("Verifying sealed Source Pack V2 and successful processing rows can be removed only by the resumable hard-delete lifecycle...");
const fixtureProjectId = "project_ci_source_delete";
const fixtureProjectSlug = "ci-source-delete";
const fixtureSourceId = "source_ci_geometry";
const fixturePackId = "source_pack_ci_v1";
const fixtureSessionId = "source_upload_ci_v1";
const fixtureProcessingJobId = "processing_job_ci_v1";
const fixtureProcessingArtifactId = "processing_artifact_ci_v1";
const fixtureJobId = "deletion_job_ci_source_v2";
const fixtureSha256 = "a".repeat(64);
const fixtureManifestSha256 = "f".repeat(64);
const fixtureArtifactSha256 = "b".repeat(64);
const fixtureOutputManifestSha256 = "c".repeat(64);
const fixtureArtifactPrefix =
  `projects/${fixtureProjectSlug}/processing/${fixturePackId}/canonical-building-v1/attempt-1/`;
const fixtureSnapshot = JSON.stringify([
  {
    id: fixtureProjectId,
    slug: fixtureProjectSlug,
    name: "CI Source Delete",
    status: "archived",
  },
]).replaceAll("'", "''");

executeJson(
  `INSERT INTO projects_3d (id,slug,name,status)
   VALUES ('${fixtureProjectId}','${fixtureProjectSlug}','CI Source Delete','draft')`,
);
executeJson(
  `INSERT INTO project_branding_3d
    (project_id,draft_logo_version,published_logo_version,updated_by)
   VALUES ('${fixtureProjectId}','brand-ci-logo-version-001','brand-ci-logo-version-001','ci@rekixo.com')`,
);
executeJson(
  `INSERT INTO project_branding_logo_versions_3d
    (project_id,version,logo_key,favicon_key,source_key,source_mime_type,created_by,published_at)
   VALUES ('${fixtureProjectId}','brand-ci-logo-version-001',
     'projects/${fixtureProjectSlug}/branding/logos/logo.webp',
     'projects/${fixtureProjectSlug}/branding/favicons/logo.png',
     'projects/${fixtureProjectSlug}/branding/logo-sources/logo.png','image/png',
     'ci@rekixo.com',datetime('now'))`,
);
executeJson(
  `INSERT INTO project_branding_shares_3d
    (project_id,experience_type,draft_title,draft_description,draft_card_version,
     draft_card_key,draft_source_key,published_version,updated_by)
   VALUES ('${fixtureProjectId}','building','CI Share Title',
     'A valid CI share description for test data','brand-ci-share-version-001',
     'projects/${fixtureProjectSlug}/branding/share/building/cards/card.webp',
     'projects/${fixtureProjectSlug}/branding/share/building/sources/source.png',
     'brand-ci-share-version-001','ci@rekixo.com')`,
);
executeJson(
  `INSERT INTO project_branding_share_versions_3d
    (project_id,experience_type,version,share_title,share_description,card_key,
     source_key,mime_type,created_by)
   VALUES ('${fixtureProjectId}','building','brand-ci-share-version-001',
     'CI Share Title','A valid CI share description for test data',
     'projects/${fixtureProjectSlug}/branding/share/building/cards/card.webp',
     'projects/${fixtureProjectSlug}/branding/share/building/sources/source.png',
     'image/webp','ci@rekixo.com')`,
);
executeJson(
  `INSERT INTO source_files_3d
    (id,project_id,filename,media_type,byte_size,sha256,r2_key,upload_state,created_by)
   VALUES
    ('${fixtureSourceId}','${fixtureProjectId}','building.fbx','application/octet-stream',1024,
     '${fixtureSha256}','projects/${fixtureProjectSlug}/sources/${fixtureSourceId}','verified','ci@rekixo.com')`,
);
executeJson(
  `INSERT INTO source_packs_3d
    (id,project_id,version,status,geometry_authority_file_id,operator_approved,
     manifest_json,manifest_sha256,created_by,approved_by)
   VALUES
    ('${fixturePackId}','${fixtureProjectId}',1,'draft','${fixtureSourceId}',1,
     '{}','${fixtureManifestSha256}','ci@rekixo.com','ci@rekixo.com')`,
);
executeJson(
  `INSERT INTO source_pack_files_3d
    (source_pack_id,project_id,source_file_id,roles_json,capabilities_json,
     classification_origin,classification_confidence,sort_order)
   VALUES
    ('${fixturePackId}','${fixtureProjectId}','${fixtureSourceId}',
     '["geometry-authority"]','["geometry"]','operator',1,0)`,
);
executeJson(
  `UPDATE source_packs_3d
      SET status='ready',updated_at=datetime('now')
    WHERE id='${fixturePackId}'`,
);
executeJson(
  `INSERT INTO source_upload_sessions_3d
    (id,source_file_id,project_id,upload_id,state,part_size,created_by)
   VALUES
    ('${fixtureSessionId}','${fixtureSourceId}','${fixtureProjectId}',
     'r2-ci-upload','completed',5242880,'ci@rekixo.com')`,
);
executeJson(
  `INSERT INTO source_upload_parts_3d
    (session_id,part_number,etag,byte_size)
   VALUES ('${fixtureSessionId}',1,'ci-etag',1024)`,
);
executeJson(
  `INSERT INTO processing_jobs_3d
    (id,project_id,source_pack_id,source_pack_version,source_pack_manifest_sha256,
     processor_version,attempt,state,artifact_prefix,requested_by,requested_at)
   VALUES
    ('${fixtureProcessingJobId}','${fixtureProjectId}','${fixturePackId}',1,
     '${fixtureManifestSha256}','canonical-building-v1',1,'queued',
     '${fixtureArtifactPrefix}','ci@rekixo.com',datetime('now'))`,
);
executeJson(
  `UPDATE processing_jobs_3d
      SET state='running',started_at=datetime('now'),heartbeat_at=datetime('now'),updated_at=datetime('now')
    WHERE id='${fixtureProcessingJobId}'`,
);
executeJson(
  `INSERT INTO processing_artifacts_3d
    (id,processing_job_id,project_id,kind,logical_id,state,r2_key,mime_type)
   VALUES
    ('${fixtureProcessingArtifactId}','${fixtureProcessingJobId}','${fixtureProjectId}',
     'canonical-model','building','staged','${fixtureArtifactPrefix}building.glb','model/gltf-binary')`,
);
executeJson(
  `UPDATE processing_artifacts_3d
      SET state='ready',byte_size=512,sha256='${fixtureArtifactSha256}',updated_at=datetime('now')
    WHERE id='${fixtureProcessingArtifactId}'`,
);
executeJson(
  `UPDATE processing_jobs_3d
      SET state='succeeded',finished_at=datetime('now'),
          output_manifest_json='{}',output_manifest_sha256='${fixtureOutputManifestSha256}',
          updated_at=datetime('now')
    WHERE id='${fixtureProcessingJobId}'`,
);
executeJson(
  `UPDATE projects_3d
      SET status='archived',updated_at=datetime('now')
    WHERE id='${fixtureProjectId}'`,
);
executeJson(
  `INSERT INTO engine_deletion_jobs_3d
    (id,kind,status,actor_email,expected_project_count,projects_json,
     deleted_projects,deleted_r2_objects,last_error)
   VALUES
    ('${fixtureJobId}','all-projects','db_cleanup_pending','ci@rekixo.com',1,
     '${fixtureSnapshot}',0,0,NULL)`,
);
executeJson(`DELETE FROM projects_3d WHERE id='${fixtureProjectId}'`);

const cascadeRows = executeJson(
  `SELECT
     (SELECT COUNT(*) FROM projects_3d WHERE id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM experiences_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM source_files_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM source_packs_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM source_pack_files_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM source_upload_sessions_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM source_upload_parts_3d WHERE session_id='${fixtureSessionId}') +
     (SELECT COUNT(*) FROM processing_jobs_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM processing_artifacts_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM project_branding_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM project_branding_logo_versions_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM project_branding_shares_3d WHERE project_id='${fixtureProjectId}') +
     (SELECT COUNT(*) FROM project_branding_share_versions_3d WHERE project_id='${fixtureProjectId}') AS total`,
);
if (Number(cascadeRows[0]?.total ?? -1) !== 0)
  throw new Error("Sealed Source Pack V2 / processing project cascade left project-owned rows behind.");
executeJson(`DELETE FROM engine_deletion_jobs_3d WHERE id='${fixtureJobId}'`);

const projectOwnedCounts = executeJson(
  `SELECT
     (SELECT COUNT(*) FROM models_3d) +
     (SELECT COUNT(*) FROM camera_presets_3d) +
     (SELECT COUNT(*) FROM scenes_3d) +
     (SELECT COUNT(*) FROM publish_versions_3d) +
     (SELECT COUNT(*) FROM studio_drafts_3d) +
     (SELECT COUNT(*) FROM studio_assets_3d) +
     (SELECT COUNT(*) FROM releases_3d) +
     (SELECT COUNT(*) FROM release_assets_3d) +
     (SELECT COUNT(*) FROM release_activations_3d) +
     (SELECT COUNT(*) FROM experiences_3d) +
     (SELECT COUNT(*) FROM geo_placements_3d) +
     (SELECT COUNT(*) FROM geo_experience_drafts_3d) +
     (SELECT COUNT(*) FROM geo_model_anchors_3d) +
     (SELECT COUNT(*) FROM geo_overlays_3d) +
     (SELECT COUNT(*) FROM geo_control_points_3d) +
     (SELECT COUNT(*) FROM geo_calibration_reports_3d) +
     (SELECT COUNT(*) FROM geo_site_boundaries_3d) +
     (SELECT COUNT(*) FROM geo_draft_verifications_3d) +
     (SELECT COUNT(*) FROM geo_releases_3d) +
     (SELECT COUNT(*) FROM geo_experience_active_releases_3d) +
     (SELECT COUNT(*) FROM geo_release_activations_3d) +
     (SELECT COUNT(*) FROM source_files_3d) +
     (SELECT COUNT(*) FROM source_packs_3d) +
     (SELECT COUNT(*) FROM source_pack_files_3d) +
     (SELECT COUNT(*) FROM source_upload_sessions_3d) +
     (SELECT COUNT(*) FROM source_upload_parts_3d) +
     (SELECT COUNT(*) FROM processing_jobs_3d) +
     (SELECT COUNT(*) FROM processing_artifacts_3d) +
     (SELECT COUNT(*) FROM engine_deletion_jobs_3d) +
     (SELECT COUNT(*) FROM project_branding_3d) +
     (SELECT COUNT(*) FROM project_branding_logo_versions_3d) +
     (SELECT COUNT(*) FROM project_branding_shares_3d) +
     (SELECT COUNT(*) FROM project_branding_share_versions_3d) AS total`,
);
if (Number(projectOwnedCounts[0]?.total ?? -1) !== 0)
  throw new Error("Fresh migration chain left project-owned rows behind.");

const migrationFiles = fs
  .readdirSync(path.join(root, "database", "migrations"))
  .filter((name) => /^\d+.*\.sql$/i.test(name))
  .sort();

const ledgerRows = executeJson("SELECT COUNT(*) AS total FROM d1_migrations");
const applied = Number(ledgerRows[0]?.total ?? -1);
if (applied !== migrationFiles.length)
  throw new Error(
    `Fresh migration ledger mismatch: expected ${migrationFiles.length}, applied ${applied}.`,
  );

console.log(
  `Fresh D1 migration chain verified: ${applied} migrations, required tables/triggers present, sealed source-pack + processing hard delete verified, project state empty.`,
);
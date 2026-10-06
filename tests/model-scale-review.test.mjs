import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "database/migrations/0037_model_scale_review.sql",
  "utf8",
);
const reviewWorker = fs.readFileSync("workers/model-scale-review.mjs", "utf8");
const canonical = fs.readFileSync("workers/canonical-glb-processor.mjs", "utf8");
const adapter = fs.readFileSync("workers/fbx-model-processor-adapter.mjs", "utf8");
const processor = fs.readFileSync("services/model-processor/server.mjs", "utf8");
const entry = fs.readFileSync("workers/admin-entry.mjs", "utf8");
const reviewUi = fs.readFileSync(
  "apps/admin/src/source-pack/ModelScaleReview.tsx",
  "utf8",
);
const processingUi = fs.readFileSync(
  "apps/admin/src/source-pack/ProcessingSpine.tsx",
  "utf8",
);

test("scale review migration is additive, source-pinned and one-way immutable", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS model_scale_reviews_3d/);
  assert.match(migration, /processing_job_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /source_sha256 TEXT NOT NULL/);
  assert.match(migration, /decision_note TEXT/);
  assert.match(migration, /trg_model_scale_reviews_3d_owner_insert/);
  assert.match(migration, /job\.state='running'/);
  assert.match(migration, /trg_model_scale_reviews_3d_transition/);
  assert.match(migration, /OLD\.status='pending'[\s\S]*NEW\.status='approved'/);
  assert.match(migration, /Approved scale review is immutable/);
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
});

test("database blocks processing retry while the preceding scale review is pending", () => {
  assert.match(migration, /trg_processing_jobs_3d_scale_review_retry_gate/);
  assert.match(migration, /previous\.attempt=NEW\.attempt-1/);
  assert.match(migration, /previous\.failure_code='FBX_SCALE_REVIEW_REQUIRED'/);
  assert.match(migration, /review\.status='pending'/);
  assert.match(migration, /Approve pending model scale review before retrying processing/);
});

test("scale approval API is guarded, audited and rejects implausible reviewed bounds", () => {
  assert.match(reviewWorker, /engineAdminReadAccess/);
  assert.match(reviewWorker, /sameOrigin/);
  assert.match(reviewWorker, /activeDeletionJob/);
  assert.match(reviewWorker, /operation='processing-write'/);
  assert.match(reviewWorker, /decisionNote\.length < 12/);
  assert.match(reviewWorker, /reviewedBounds\(diagnostic, metresPerSourceUnit\)/);
  assert.match(reviewWorker, /Largest dimension must remain between/);
  assert.match(reviewWorker, /processing\.scale_review_approved/);
  assert.match(reviewWorker, /status='approved',metres_per_source_unit=\?,decision_note=\?/);
});

test("canonical retry consumes only the durable approved source-identity scale decision", () => {
  assert.match(canonical, /recordScaleReviewRequired/);
  assert.match(canonical, /FBX_SCALE_REVIEW_REQUIRED/);
  assert.match(canonical, /approvedScaleDecision/);
  assert.match(canonical, /source_pack_id=\?/);
  assert.match(canonical, /source_file_id=\?/);
  assert.match(canonical, /source_sha256=\?/);
  assert.match(canonical, /status !== "approved"/);
  assert.match(canonical, /scaleDecision:/);
  assert.match(canonical, /scaleDecisionId/);
});

test("V4 adapter and isolated processor verify reviewed scale decision provenance end to end", () => {
  assert.match(adapter, /FBX_MODEL_PROCESSOR_VERSION = 4/);
  assert.match(adapter, /serialized-node-fbx-v4-reviewed-scale/);
  assert.match(adapter, /x-rekixo-scale-decision-id/);
  assert.match(adapter, /x-rekixo-reviewed-metres-per-source-unit/);
  assert.match(adapter, /decisionId !== identity\.scaleDecision\.id/);
  assert.match(adapter, /metreScale !== identity\.scaleDecision\.metresPerSourceUnit/);
  assert.match(processor, /FBX_PROCESSOR_VERSION = 4/);
  assert.match(processor, /reviewedScaleDecisions: "supported"/);
  assert.match(processor, /metresPerSourceUnitOverride/);
  assert.match(processor, /x-rekixo-scale-basis/);
  assert.match(processor, /x-rekixo-scale-decision-id/);
});

test("Admin UI requires explicit scale and rationale before enabling scale-review retry", () => {
  assert.match(entry, /handleModelScaleReviewRequest/);
  assert.match(reviewUi, /useState\(""\)/);
  assert.match(reviewUi, /Approval reason \/ evidence/);
  assert.match(reviewUi, /note: cleanNote/);
  assert.match(reviewUi, /onApprovalChange/);
  assert.match(reviewUi, /Koi default scale assume nahi kiya gaya hai/);
  assert.match(processingUi, /import ModelScaleReview from "\.\/ModelScaleReview"/);
  assert.match(processingUi, /failureCode === "FBX_SCALE_REVIEW_REQUIRED"/);
  assert.match(processingUi, /!retryNeedsScaleApproval \|\| scaleReviewApproved/);
  assert.match(processingUi, /<ModelScaleReview slug=\{slug\} onApprovalChange=\{setScaleReviewApproved\} \/>/);
});

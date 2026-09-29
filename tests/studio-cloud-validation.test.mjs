import assert from "node:assert/strict";
import test from "node:test";
import {
  publicStudioSnapshot,
  validateStudioDraft,
} from "../workers/studio-draft-validation.mjs";

function fixture() {
  const project = { id: "project_12345678", slug: "tower-one" };
  const draft = {
    schema: 1,
    id: project.id,
    slug: project.slug,
    name: "Tower One",
    location: "Test City",
    referenceUrl: "https://example.com/internal-reference",
    brief: "Private operator brief",
    updated: "2026-09-29T00:00:00.000Z",
    assets: ["asset_model_1234", "asset_plan_12345"],
    releases: [],
    cloud: { revision: 8, syncedAt: "2026-09-29T00:00:00.000Z" },
    scene: {
      scale: 1,
      modelId: "asset_model_1234",
      floors: [{ id: "floor_ground", name: "Ground", elevation: 0 }],
      rooms: [{
        id: "room_living",
        name: "Living",
        unit: "A1",
        floorId: "floor_ground",
        x: 0,
        z: 0,
        width: 4,
        depth: 3,
        height: 2.8,
        color: "#dddddd",
        source: "Private drawing page 4",
        verified: true,
        sourceAssetId: "asset_plan_12345",
        sourcePackSourceId: "source-private-plan",
        sourceClaimIds: ["claim-private-room"],
        mesh: "InternalLivingMesh",
      }],
      furniture: [],
      openings: [
        {
          id: "door_reviewed",
          floorId: "floor_ground",
          kind: "door",
          roomIds: ["room_living"],
          x: 0,
          y: 1.05,
          z: -1.5,
          width: 0.9,
          height: 2.1,
          rotationY: 0,
          reviewed: true,
          sourceNodeName: "DoorMesh",
          sourceOccurrence: 1,
          confidence: 0.99,
        },
        {
          id: "door_unreviewed",
          floorId: "floor_ground",
          kind: "door",
          roomIds: ["room_living"],
          x: 1,
          y: 1.05,
          z: -1.5,
          width: 0.9,
          height: 2.1,
          rotationY: 0,
          reviewed: false,
        },
      ],
      referenceLayers: [{
        id: "reference_layer",
        assetId: "asset_plan_12345",
        visible: true,
        opacity: 0.7,
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
      }],
      modelNodeTags: [{
        nodeName: "DoorMesh",
        occurrence: 1,
        floorId: "floor_ground",
        roomId: "room_living",
        unit: "A1",
        assignment: "manual",
        confidence: 1,
        semantic: "door",
        semanticAssignment: "manual",
        semanticConfidence: 1,
      }],
    },
  };
  return { project, draft };
}

test("server validator accepts a structurally valid Studio draft", () => {
  const { project, draft } = fixture();
  assert.deepEqual(validateStudioDraft(draft, project), draft.assets);
});

test("server validator rejects malformed cross-entity Studio drafts", () => {
  const missingAsset = fixture();
  missingAsset.draft.scene.rooms[0].sourceAssetId = "missing_asset";
  assert.throws(
    () => validateStudioDraft(missingAsset.draft, missingAsset.project),
    /room/i,
  );

  const badOpening = fixture();
  badOpening.draft.scene.openings[0].roomIds = ["missing-room"];
  assert.throws(
    () => validateStudioDraft(badOpening.draft, badOpening.project),
    /opening/i,
  );

  const badPolygon = fixture();
  Object.assign(badPolygon.draft.scene.rooms[0], {
    polygon: [[0, 0], [4, 0], [0, 3]],
  });
  assert.throws(
    () => validateStudioDraft(badPolygon.draft, badPolygon.project),
    /polygon bounds/i,
  );
});

test("public Studio snapshot is allowlisted and strips operator evidence", () => {
  const { project, draft } = fixture();
  validateStudioDraft(draft, project);
  const published = publicStudioSnapshot(draft);

  assert.equal(published.brief, undefined);
  assert.equal(published.referenceUrl, undefined);
  assert.equal(published.cloud, undefined);
  assert.deepEqual(published.releases, []);
  assert.deepEqual(published.assets, ["asset_model_1234"]);
  assert.deepEqual(published.scene.referenceLayers, []);
  assert.deepEqual(published.scene.modelNodeTags, []);
  assert.equal(published.scene.rooms[0].sourceAssetId, undefined);
  assert.equal(published.scene.rooms[0].sourcePackSourceId, undefined);
  assert.equal(published.scene.rooms[0].sourceClaimIds, undefined);
  assert.equal(published.scene.rooms[0].mesh, undefined);
  assert.equal(published.scene.rooms[0].source, "Published reviewed geometry.");
  assert.equal(published.scene.openings.length, 1);
  assert.equal(published.scene.openings[0].id, "door_reviewed");
  assert.equal(published.scene.openings[0].sourceNodeName, undefined);
  assert.equal(published.scene.openings[0].confidence, undefined);
});

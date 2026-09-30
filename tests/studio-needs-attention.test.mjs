import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const draftModule = await import(
  asUrl(compile("apps/admin/src/studio/reviewDrafts.ts"))
);

const room = (overrides = {}) => ({
  id: "draft",
  name: "Living · layout draft",
  floorId: "ground",
  unit: "Unit 101",
  x: 0,
  z: 0,
  width: 4.95,
  depth: 3.05,
  height: 2.8,
  color: "#cdbfa9",
  source: "",
  verified: false,
  ...overrides,
});

const scene = (overrides = {}) => ({
  scale: 1,
  floors: [{ id: "ground", name: "Ground", elevation: 0 }],
  rooms: [],
  furniture: [],
  openings: [],
  ...overrides,
});

test("unsourced legacy room drafts are removable only when dependency-free", () => {
  const target = room();
  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({ rooms: [target] }),
      target,
    ),
    true,
  );

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({ rooms: [{ ...target, verified: true }] }),
      { ...target, verified: true },
    ),
    false,
  );

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({ rooms: [{ ...target, sourcePackSourceId: "source" }] }),
      { ...target, sourcePackSourceId: "source" },
    ),
    false,
  );

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({
        rooms: [target],
        furniture: [{ id: "chair", roomId: target.id }],
      }),
      target,
    ),
    false,
  );

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({
        rooms: [target],
        openings: [{ id: "door", roomIds: [target.id] }],
      }),
      target,
    ),
    false,
  );
});

test("generated repeat drafts cannot be mistaken for removable legacy drafts", () => {
  const generated = room({
    source:
      "Batch repeated draft from Floor 1 · 101 → 201. Geometry is copied for authoring convenience and requires visual review.",
  });
  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({ rooms: [generated] }),
      generated,
    ),
    false,
  );
});

test("Review UI prioritizes unresolved work and keeps reviewed rooms collapsed", () => {
  const evidence = fs.readFileSync(
    "apps/admin/src/studio/StudioEvidence.tsx",
    "utf8",
  );
  assert.match(evidence, /Needs attention/);
  assert.match(evidence, /Unresolved rooms/);
  assert.match(evidence, /Reviewed rooms ·/);
  assert.match(evidence, /Remove superseded draft/);
  assert.match(evidence, /isRemovableUnsourcedDraft/);
});

test("readiness exposes walkthrough evidence instead of inventing openings", () => {
  const readiness = fs.readFileSync(
    "apps/admin/src/studio/readiness.ts",
    "utf8",
  );
  assert.match(readiness, /No source-backed walkthrough openings/);
  assert.match(readiness, /Walkthrough connectivity stays disabled rather than inventing architectural openings/);
  assert.match(readiness, /reviewed shared doors/);
});


test("brochure-backed Ground layout draft is removable only when a reviewed replacement exists", () => {
  const ground = room({
    source:
      "Brochure page 2 living dimensions. Studio placement is a draft and needs alignment with the source material.",
  });
  const replacement = room({
    id: "living-101",
    name: "Living",
    floorId: "floor-1",
    unit: "101",
    height: 2.75,
    source: "Brochure page 2 floor-plan reference",
    sourcePackSourceId: "jyoti-source-brochure",
    verified: true,
  });
  const floors = [
    { id: "ground", name: "Ground", elevation: 0 },
    { id: "floor-1", name: "Floor 1", elevation: 3.048 },
  ];

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({ floors, rooms: [ground, replacement] }),
      ground,
    ),
    true,
  );

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({ floors, rooms: [ground] }),
      ground,
    ),
    false,
  );

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({
        floors,
        rooms: [ground, replacement],
        furniture: [{ id: "chair", roomId: ground.id }],
      }),
      ground,
    ),
    true,
  );
});


test("mesh-bound superseded brochure draft may be removed while generic mesh drafts stay protected", () => {
  const floors = [
    { id: "ground", name: "Ground", elevation: 0 },
    { id: "floor-1", name: "Floor 1", elevation: 3.048 },
  ];
  const ground = room({
    mesh: "LegacyMesh",
    source:
      "Brochure page 2 living dimensions. Studio placement is a draft and needs alignment with the source material.",
  });
  const replacement = room({
    id: "living-101",
    name: "Living",
    floorId: "floor-1",
    unit: "101",
    height: 2.75,
    verified: true,
    sourcePackSourceId: "jyoti-source-brochure",
  });

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({ floors, rooms: [ground, replacement] }),
      ground,
    ),
    true,
  );

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(
      scene({ rooms: [room({ mesh: "SomeMesh" })] }),
      room({ mesh: "SomeMesh" }),
    ),
    false,
  );
});

test("legacy room cleanup preserves model tags while clearing the removed room binding", () => {
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");
  assert.match(studio, /modelNodeTags: \(p\.scene\.modelNodeTags \?\? \[\]\)\.map/);
  assert.match(studio, /if \(tag\.roomId !== key\) return tag/);
  assert.match(studio, /delete preserved\.roomId/);
});


test("superseded brochure draft can migrate furniture to its reviewed replacement", () => {
  const floors = [
    { id: "ground", name: "Ground", elevation: 0 },
    { id: "floor-1", name: "Floor 1", elevation: 3.048 },
  ];
  const ground = room({
    source:
      "Brochure page 2 living dimensions. Studio placement is a draft and needs alignment with the source model.",
  });
  const replacement = room({
    id: "living-101",
    name: "Living",
    floorId: "floor-1",
    unit: "101",
    source: "Brochure source",
    verified: true,
  });
  const current = scene({
    floors,
    rooms: [ground, replacement],
    furniture: [{ id: "sofa", roomId: ground.id }],
  });

  assert.equal(
    draftModule.isRemovableUnsourcedDraft(current, ground),
    true,
  );
  assert.equal(
    draftModule.findSupersedingReviewedRoom(current, ground)?.id,
    replacement.id,
  );
});

test("Studio cleanup migrates furniture and blocks new furnishing on superseded draft", () => {
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");
  assert.match(studio, /item\.roomId === key && replacement/);
  assert.match(studio, /roomId: replacement\.id/);
  assert.match(studio, /legacyDraftFurnitureBlocked/);
  assert.match(studio, /Remove\/review this superseded draft before furnishing/);
});

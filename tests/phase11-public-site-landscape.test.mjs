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

const runtimeContext = await import(
  asUrl(compile("apps/public/src/viewer/publicRuntimeContext.ts")),
);
const runtimeValidation = await import(
  asUrl(compile("packages/contracts/src/runtime-validation.ts")),
);

test("Phase 11 converts reviewed Studio site elements into model-local public coordinates", () => {
  const elements = runtimeContext.derivePublicSiteElementsFromStudio({
    scene: {
      scale: 2,
      modelTransform: { x: 10, y: 4, z: 20, rotationY: 90 },
      siteElements: [
        {
          id: "tree-1",
          kind: "tree",
          x: 12,
          z: 20,
          width: 4,
          depth: 4,
          height: 8,
          rotation: 90,
          color: "#4F7B48",
          reviewed: true,
        },
      ],
    },
  });

  assert.equal(elements.length, 1);
  assert.equal(elements[0].id, "tree-1");
  assert.ok(Math.abs(elements[0].x) < 1e-9);
  assert.ok(Math.abs(elements[0].z - 1) < 1e-9);
  assert.equal(elements[0].y, -2);
  assert.equal(elements[0].width, 2);
  assert.equal(elements[0].depth, 2);
  assert.equal(elements[0].height, 4);
  assert.ok(Math.abs(elements[0].rotation) < 1e-9);
  assert.equal(elements[0].color, "#4f7b48");
});

test("Phase 11 publishes only reviewed valid site elements", () => {
  const elements = runtimeContext.derivePublicSiteElementsFromStudio({
    scene: {
      siteElements: [
        {
          id: "reviewed-road",
          kind: "road",
          x: 0,
          z: 0,
          width: 5,
          depth: 20,
          height: 0.05,
          rotation: 0,
          color: "#67696b",
          reviewed: true,
        },
        {
          id: "draft-tree",
          kind: "tree",
          x: 2,
          z: 2,
          width: 2,
          depth: 2,
          height: 5,
          rotation: 0,
          color: "#4f7b48",
          reviewed: false,
        },
        {
          id: "bad-color",
          kind: "lawn",
          x: 0,
          z: 0,
          width: 5,
          depth: 5,
          height: 0.05,
          rotation: 0,
          color: "green",
          reviewed: true,
        },
      ],
    },
  });

  assert.deepEqual(elements.map((item) => item.id), ["reviewed-road"]);
});

test("Phase 11 public contract accepts bounded site elements and rejects corruption", () => {
  const experience = {
    project: {
      id: "project-1",
      slug: "site-project",
      name: "Site Project",
      status: "published",
    },
    siteElements: [
      {
        id: "gate-1",
        kind: "gate",
        x: 0,
        y: 0,
        z: 3,
        width: 3.5,
        depth: 0.25,
        height: 1.8,
        rotation: 0,
        color: "#5e5851",
      },
    ],
  };

  assert.doesNotThrow(() =>
    runtimeValidation.assertPublic3DExperiencePayload(experience),
  );

  const invalid = structuredClone(experience);
  invalid.siteElements[0].width = -1;
  assert.throws(
    () => runtimeValidation.assertPublic3DExperiencePayload(invalid),
    /Invalid public site element/,
  );
});

test("Phase 11 public loader reads the immutable Studio release as additive site data", () => {
  const api = fs.readFileSync("apps/public/src/api.ts", "utf8");
  const context = fs.readFileSync(
    "apps/public/src/viewer/publicRuntimeContext.ts",
    "utf8",
  );

  assert.match(api, /api\/releases\/projects\/\$\{encodeURIComponent\(slug\)\}\/studio/);
  assert.match(api, /derivePublicSiteElementsFromStudio/);
  assert.match(api, /setPublicRuntimeSiteElements/);
  assert.match(api, /Studio geometry is additive/);
  assert.match(context, /raw\.reviewed !== true/);
  assert.match(context, /modelTransform/);
});

test("Phase 11 site environment uses source-backed instancing and night-safe outdoor lights", () => {
  const environment = fs.readFileSync(
    "apps/public/src/viewer/siteEnvironment.ts",
    "utf8",
  );

  assert.match(environment, /getPublicRuntimeSiteElements/);
  assert.match(environment, /THREE\.InstancedMesh/);
  assert.match(environment, /sourceBackedSiteElementCount/);
  assert.match(environment, /outdoor-light/);
  assert.match(environment, /emissiveIntensity = night \? 4\.2 : 0\.38/);
  assert.doesNotMatch(environment, /synthetic circular ground/i);
});

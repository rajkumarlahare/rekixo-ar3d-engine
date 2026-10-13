import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("new Building presentation manifests receive a versioned additive cinematic profile", () => {
  const contract = read("packages/contracts/src/building-presentation-manifest-v1.ts");
  const planner = read("apps/admin/src/studio/buildingPresentationPlanner.ts");

  assert.match(contract, /interface BuildingEnvironmentProfileV1/);
  assert.match(contract, /format: "rekixo-environment-profile"/);
  assert.match(contract, /siteDataPolicy: "additive"/);
  assert.match(contract, /water: "opt-in" \| "off"/);
  assert.match(contract, /traffic: "opt-in" \| "off"/);
  assert.match(planner, /DEFAULT_BUILDING_ENVIRONMENT_PROFILE_V1/);
  assert.equal(
    (planner.match(/profile: structuredClone\(DEFAULT_BUILDING_ENVIRONMENT_PROFILE_V1\)/g) ?? []).length,
    2,
    "source-backed and generic projects must receive the same default profile",
  );
});

test("old customer releases get the default profile at runtime without rewriting their manifest", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(viewer, /Historical V1 releases predate environment profiles/);
  assert.match(viewer, /buildingPresentation\?\.environment\.profile \?\?/);
  assert.match(viewer, /DEFAULT_BUILDING_ENVIRONMENT_PROFILE_V1/);
  assert.match(viewer, /buildingPresentation\?\.environment\.mode === "minimal"/);
});

test("baseline environment layers are additive when reviewed site data is sparse", () => {
  const site = read("apps/public/src/viewer/siteEnvironment.ts");
  assert.match(site, /baselinePolicy: "empty-only" \| "always" = "empty-only"/);
  assert.match(site, /baselinePolicy === "always" \|\| elements\.length === 0/);
  assert.match(site, /includeRoad: !hasRoad/);
  assert.match(site, /includeSidewalk: !hasPath/);
  assert.match(site, /includeLawn: !hasLawn/);
  assert.match(site, /includeTrees: trees\.length === 0/);
  assert.match(site, /includePlants: plants\.length === 0/);
  assert.match(site, /root\.userData\.presentationOnly = true/);
  assert.match(site, /createProceduralSurfaceMaterial/);
});

test("default roads, paths, ground and lawns use deterministic procedural surface detail", () => {
  const surfaces = read("apps/public/src/viewer/proceduralSurfaceMaterials.ts");
  const fallback = read("apps/public/src/viewer/presentationEnvironment.ts");
  const site = read("apps/public/src/viewer/siteEnvironment.ts");

  assert.match(surfaces, /new THREE\.DataTexture/);
  assert.match(surfaces, /textureCache\.get\(kind\)/);
  assert.match(surfaces, /textureCache\.set\(kind, texture\)/);
  assert.match(surfaces, /THREE\.SRGBColorSpace/);
  assert.doesNotMatch(surfaces, /Math\.random|fetch\(/);
  assert.match(fallback, /surfaceKindForName/);
  assert.match(site, /first\.kind === "road" \|\| first\.kind === "parking"/);
  assert.match(site, /first\.kind === "lawn" \|\| first\.kind === "garden"/);
});

test("generated vegetation motion is wired to the customer render loop and respects reduced motion", () => {
  const motion = read("apps/public/src/viewer/premiumPresentationMotion.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const sky = read("apps/public/src/viewer/exteriorSky.ts");

  assert.match(motion, /environmentRoot\.userData\.presentationOnly !== true/);
  assert.match(motion, /options\.reducedMotion/);
  assert.match(motion, /object\.name === "Site tree"/);
  assert.match(motion, /object\.name === "Site plant"/);
  assert.match(viewer, /createPremiumPresentationMotion\(siteEnvironment\.root/);
  assert.match(viewer, /presentationMotion\?\.update\(delta\)/);
  assert.match(viewer, /presentationMotion\?\.dispose\(\)/);
  assert.match(viewer, /environmentProfile\.motion\.vegetation !== "off"/);
  assert.match(sky, /createExteriorSky\(reducedMotion: boolean, driftClouds = true\)/);
  assert.match(sky, /!reducedMotion && driftClouds/);
});

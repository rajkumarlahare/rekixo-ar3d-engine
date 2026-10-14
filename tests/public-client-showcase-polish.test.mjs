import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";
const require = createRequire(import.meta.url);
const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve("three")), "three.module.js")).href;
const asUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
function compile(file, imports = {}) {
  let code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('from "three"', `from "${threeUrl}"`);
  for (const [key, value] of Object.entries(imports)) code = code.replaceAll(`from "${key}"`, `from "${value}"`);
  return asUrl(code);
}
const client = await import(compile("apps/public/src/clientPresentation.ts"));
const camera = await import(compile("apps/public/src/viewer/exteriorCamera.ts"));
const source = await import(compile("apps/public/src/viewer/sourcePresentation.ts"));
const runtimeUrl = compile("apps/public/src/viewer/publicRuntimeContext.ts");
const runtime = await import(runtimeUrl);
const surfaceUrl = compile("apps/public/src/viewer/proceduralSurfaceMaterials.ts");
const presentationUrl = compile("apps/public/src/viewer/presentationEnvironment.ts", {
  "./proceduralSurfaceMaterials": surfaceUrl,
});
const grassUrl = compile("apps/public/src/viewer/grassGroundCover.ts", {
  "./proceduralSurfaceMaterials": surfaceUrl,
});
const grass = await import(grassUrl);
const buildingFootprint = await import(compile("apps/public/src/viewer/buildingFootprint.ts"));
const environment = await import(compile("apps/public/src/viewer/siteEnvironment.ts", {
  "./publicRuntimeContext": runtimeUrl,
  "./presentationEnvironment": presentationUrl,
  "./proceduralSurfaceMaterials": surfaceUrl,
  "./grassGroundCover": grassUrl,
}));

test("footprint inference separates the Building from low compound walls and ground meshes", () => {
  const root = new THREE.Group();
  const addPart = (name, width, height, depth, x, y, z) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial(),
    );
    mesh.name = name;
    mesh.position.set(x, y, z);
    root.add(mesh);
  };

  // Large flat site/paving and short compound walls must not inflate the hole.
  addPart("Ground plane", 44, 0.1, 32, 8, 0, 5);
  addPart("North compound wall", 44, 1.8, 0.25, 8, 0.9, 21);
  addPart("South compound wall", 44, 1.8, 0.25, 8, 0.9, -11);
  addPart("East compound wall", 0.25, 1.8, 32, 30, 0.9, 5);
  addPart("West compound wall", 0.25, 1.8, 32, -14, 0.9, 5);

  // A multi-storey building assembled from storey-height wall meshes.
  for (let floor = 0; floor < 4; floor += 1) {
    const y = floor * 3 + 1.5;
    addPart(`Floor ${floor} north wall`, 10, 3, 0.2, 0, y, 4);
    addPart(`Floor ${floor} south wall`, 10, 3, 0.2, 0, y, -4);
    addPart(`Floor ${floor} east wall`, 0.2, 3, 8, 5, y, 0);
    addPart(`Floor ${floor} west wall`, 0.2, 3, 8, -5, y, 0);
  }

  const siteBounds = new THREE.Box3(
    new THREE.Vector3(-14, 0, -11),
    new THREE.Vector3(30, 20, 21),
  );
  const inferred = buildingFootprint.deriveBuildingFootprintBounds(
    root,
    siteBounds,
  );
  assert.ok(Math.abs(inferred.min.x + 5.1) < 0.2);
  assert.ok(Math.abs(inferred.max.x - 5.1) < 0.2);
  assert.ok(Math.abs(inferred.min.z + 4.1) < 0.2);
  assert.ok(Math.abs(inferred.max.z - 4.1) < 0.2);
  for (const child of root.children) {
    child.geometry.dispose();
    child.material.dispose();
  }
});

test("curved ground mesh has a building-sized hole, not turf under interior walls", () => {
  // The loaded source bounds include the compound/site; the measured Building
  // bounds are deliberately smaller so the open plot remains covered in grass.
  const bounds = new THREE.Box3(
    new THREE.Vector3(-14, 0, -11),
    new THREE.Vector3(30, 20, 21),
  );
  const footprintBounds = new THREE.Box3(
    new THREE.Vector3(-5, 0, -4),
    new THREE.Vector3(5, 15, 4),
  );
  const cover = grass.createUniversalGrassGroundCover({
    bounds,
    footprintBounds,
    groundElevation: 0,
    mobile: true,
    excludedAreas: [{
      kind: "building-footprint",
      x: 0,
      z: 0,
      width: 10,
      depth: 8,
      rotation: 0,
    }],
    lawnAreas: [],
  });
  const ground = cover.root.children.find(
    (child) => child.name === "Curved turf and horizon surface",
  );
  assert.ok(ground?.isMesh);
  const positions = ground.geometry.getAttribute("position");
  assert.ok(positions.count > 1000, "curved horizon retains its outer landscape mesh");
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    assert.ok(
      Math.abs(x) >= 5 || Math.abs(z) >= 4,
      `ground vertex ${index} intrudes into the building footprint at (${x}, ${z})`,
    );
  }
  const indices = ground.geometry.index;
  assert.ok(indices && indices.count > 1000);
  assert.ok(Math.abs(positions.getX(0) - 5.18) < 1e-3);
  assert.equal(cover.root.position.x, 0, "terrain is centered on the measured Building");
  assert.equal(cover.root.position.z, 0, "terrain is centered on the measured Building");
  let farthestSiteCoverage = 0;
  for (let index = 0; index < positions.count; index += 1) {
    farthestSiteCoverage = Math.max(
      farthestSiteCoverage,
      Math.hypot(positions.getX(index), positions.getZ(index)),
    );
  }
  assert.ok(farthestSiteCoverage > 30, "curved turf still spans the outer project bounds");
  cover.dispose();
});

test("client modules exclude disabled and absent scenes", () => {
  assert.deepEqual(client.availableClientModules({ scenes: [{ type: "project-navigation", enabled: true }, { type: "typical-floor", enabled: false }] }, ["project-navigation", "typical-floor", "amenity"]), ["project-navigation"]);
});
test("exact maps require finite valid coordinates and preserve zero coordinates", () => {
  assert.equal(client.exactMapLinks({ latitude: 91, longitude: 3 }), undefined);
  assert.equal(client.exactMapLinks({ latitude: NaN, longitude: 3 }), undefined);
  assert.equal(client.exactMapLinks({ address: "Town" }), undefined);
  assert.match(client.exactMapLinks({ latitude: 0, longitude: 0 }).open, /0%2C0/);
});
test("contact and media links reject executable schemes and malformed values", () => {
  assert.equal(client.contactLinks({ phone: "javascript:alert(1)", email: "x@y.com?subject=spam" }).phone, undefined);
  assert.equal(client.contactLinks({ email: "x@y.com?subject=spam" }).email, undefined);
  assert.equal(client.contactLinks({ phone: "+91 (123) 456-7890" }).phone, "tel:+911234567890");
  assert.equal(client.publishedMediaUrl("/media", "../.."), undefined);
});
test("exterior views keep every measured building corner in portrait and landscape frames", () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-7, 0, -5), new THREE.Vector3(7, 24, 5));
  const home = { position: new THREE.Vector3(40, 25, 40), target: new THREE.Vector3(0, 12, 0), fov: 42 };
  for (const aspect of [0.45, 1, 1.8]) for (const view of ["hero", "front", "corner", "aerial"]) {
    const next = camera.exteriorCameraView(bounds, home, aspect, view);
    const lens = new THREE.PerspectiveCamera(next.fov, aspect, 0.01, 1000);
    lens.position.copy(next.position); lens.lookAt(next.target); lens.updateMatrixWorld();
    for (const x of [-7, 7]) for (const y of [0, 24]) for (const z of [-5, 5]) {
      const p = new THREE.Vector3(x, y, z).project(lens);
      assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1, `${view} ${aspect}: ${p.toArray()}`);
    }
  }
});
test("source-backed environments retain instancing while the presentation root remains a safe site layer", () => {
  runtime.setPublicRuntimeSiteElements([{ id: "tree-1", kind: "tree", x: 0, y: 0, z: 4, width: 2, depth: 2, height: 4, rotation: 0, color: "#228844" }]);
  const result = environment.createArchitecturalSiteEnvironment(new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 20, 4)), {}, false, true);
  assert.equal(result.root.userData.sourceBackedSiteElementCount, 1);
  assert.ok(result.root.children.some((mesh) => mesh.isInstancedMesh));
  assert.equal(result.root.userData.presentationOnly, true);
  assert.equal(result.root.userData.nonAuthoritative, true);
  assert.ok(result.root.children.some((mesh) => mesh.name === "Site tree trunks"));
  result.dispose(); runtime.clearPublicRuntimeSiteElements();
});
test("reviewed water features render as translucent animated physical surfaces", () => {
  const water = {
    id: "reviewed-pool",
    kind: "water",
    x: 0,
    y: 0,
    z: 0,
    width: 6,
    depth: 3,
    height: 0.04,
    rotation: 0,
    color: "#4c9cc5",
  };
  runtime.setPublicRuntimeSiteElements([water]);
  const result = environment.createArchitecturalSiteEnvironment(
    new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 20, 4)),
    {},
    false,
    true,
    0,
    "always",
    true,
  );
  const group = result.root.children.find((node) => node.name === "Reviewed site water feature");
  assert.ok(group);
  const mesh = group.children.find((node) => node.isMesh && node.userData.sourceSiteElementId === "reviewed-pool");
  assert.ok(mesh);
  assert.ok(mesh.material.isMeshPhysicalMaterial);
  assert.equal(mesh.material.transparent, true);
  assert.ok(mesh.material.clearcoat >= 0.9);
  mesh.material.onBeforeCompile({
    uniforms: {},
    vertexShader: "#include <common>\\nvoid main() {\\n#include <begin_vertex>\\n}",
    fragmentShader: "",
  }, {});
  const before = mesh.material.userData.elapsed;
  result.update(0.05);
  assert.ok(mesh.material.userData.elapsed > before);
  assert.ok(mesh.material.userData.waterShader.uniforms.uRekixoWaterTime.value > before);
  result.dispose();
  runtime.clearPublicRuntimeSiteElements();
});

test("generic exterior dressing is opt-in and clearly non-authoritative", () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 20, 4));
  const plain = environment.createArchitecturalSiteEnvironment(bounds, {}, false);
  assert.equal(plain.root.children.length, 0); plain.dispose();
  const dressed = environment.createArchitecturalSiteEnvironment(bounds, {}, true, true);
  assert.equal(dressed.root.userData.presentationOnly, true);
  assert.equal(dressed.root.userData.nonAuthoritative, true);
  dressed.setNight(true); dressed.dispose();
});
const bytes = new TextEncoder().encode("verified-model");
const sha = createHash("sha256").update(bytes).digest("hex");
const presentation = { format: "rekixo-public-presentation-v1", releaseManifestSha256: "a".repeat(64), modelId: "model-a", modelSha256: sha, sourceArchiveSha256: "b".repeat(64), materials: [{ name: "wall", color: "#ab9876", sourcePath: "materials/wall/material.xml" }] };
test("recovered materials reject another release, model, malformed tint or external texture", () => {
  assert.ok(source.parseSourcePresentation(presentation, "a".repeat(64), "model-a"));
  assert.equal(source.parseSourcePresentation(presentation, "c".repeat(64), "model-a"), undefined);
  assert.equal(source.parseSourcePresentation(presentation, "a".repeat(64), "model-b"), undefined);
  assert.equal(source.parseSourcePresentation({ ...presentation, materials: [{ name: "wall", color: "red", sourcePath: "x", texture: "https://other/image.jpg" }] }, "a".repeat(64), "model-a"), undefined);
});
test("recovered colors apply only to the exact model digest", async () => {
  const root = new THREE.Group(), material = new THREE.MeshStandardMaterial({ color: "#ffffff" }); material.name = "wall";
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  await source.applySourcePresentation(root, presentation, new TextEncoder().encode("different").buffer, {}, () => false);
  assert.equal(material.color.getHexString(), "ffffff");
  await source.applySourcePresentation(root, presentation, bytes.buffer, {}, () => false);
  assert.equal(material.color.getHexString(), "ab9876");
  root.children[0].geometry.dispose(); material.dispose();
});
test("checked-in presentation assets are release-bound, small, and contain recovered image bytes", () => {
  for (const dir of fs.readdirSync("apps/public/public/presentations")) {
    const base = path.join("apps/public/public/presentations", dir);
    const data = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
    assert.ok(source.parseSourcePresentation(data, dir, data.modelId));
    let total = 0;
    for (const item of data.materials) if (item.texture) { const bytes = fs.readFileSync(path.join(base, item.texture)); assert.equal(bytes.toString("ascii", 0, 4), "RIFF"); total += bytes.length; }
    assert.ok(total < 2 * 1024 * 1024);
  }
});

test("published walkthrough remains available when the Floor Explorer scene is disabled", () => {
  const capability = client.clientViewerCapabilities({ scenes: [{ type: "typical-floor", enabled: false }], walkthrough: { rooms: [{ id: "reviewed-room" }] } });
  assert.deepEqual(capability, { floors: false, walk: true });
});
test("basement presentation uses an authored ground elevation or omits uncertain dressing", () => {
  runtime.clearPublicRuntimeSiteElements();
  const bounds = new THREE.Box3(new THREE.Vector3(-4, -3, -4), new THREE.Vector3(4, 20, 4));
  const unknown = environment.createArchitecturalSiteEnvironment(bounds, {}, false, true);
  assert.equal(unknown.root.children.length, 0); unknown.dispose();
  const known = environment.createArchitecturalSiteEnvironment(bounds, {}, false, true, 0);
  const road = known.root.children.find((node) => node.name === "Presentation road");
  assert.ok(road && road.position.y > -0.1); known.dispose();
});

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
const environment = await import(compile("apps/public/src/viewer/siteEnvironment.ts", {
  "./publicRuntimeContext": runtimeUrl,
  "./presentationEnvironment": compile("apps/public/src/viewer/presentationEnvironment.ts"),
}));

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
test("source-backed environments retain instancing and suppress generic dressing", () => {
  runtime.setPublicRuntimeSiteElements([{ id: "tree-1", kind: "tree", x: 0, y: 0, z: 4, width: 2, depth: 2, height: 4, rotation: 0, color: "#228844" }]);
  const result = environment.createArchitecturalSiteEnvironment(new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 20, 4)), {}, false, true);
  assert.equal(result.root.userData.sourceBackedSiteElementCount, 1);
  assert.ok(result.root.children.some((mesh) => mesh.isInstancedMesh));
  assert.notEqual(result.root.userData.presentationOnly, true);
  result.dispose(); runtime.clearPublicRuntimeSiteElements();
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

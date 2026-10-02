import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";

const compile = source => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source.replace('import * as THREE from "three";', `import * as THREE from ${JSON.stringify(import.meta.resolve("three"))};`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64");
const contextUrl = compile(fs.readFileSync("packages/model-profiles/src/referenceContext.ts", "utf8"));
const sourceProfileUrl = compile(`
export const JYOTI_SOURCE_MODEL_SHA256 = "1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0";
export const JYOTI_SOURCE_FLOOR_LEVELS_M = [0, 3.048, 6.0452, 9.0424, 12.0396, 15.0368, 18.034];
`);
const source = fs.readFileSync("packages/model-profiles/src/referenceExterior.ts", "utf8")
  .replace('"./referenceContext"', JSON.stringify(contextUrl))
  .replace('"./referenceSourceRuntime"', JSON.stringify(sourceProfileUrl));
const { applyJyotiReferenceExterior } = await import(compile(source));

test("look development does not modify other tenants or source revisions", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  root.add(mesh);
  const material = mesh.material;
  assert.equal(applyJyotiReferenceExterior(root), undefined);
  assert.equal(root.children.length, 1);
  assert.equal(mesh.material, material);
});

test("reference finishes retain source geometry and produce attached details and usable lighting", () => {
  const root = new THREE.Group();
  root.userData.sourceGeometry = { sha256: "1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0" };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name:"Marble_Carrara_Floor_Tile"}));
  mesh.name = "Mesh470"; mesh.position.set(11, 3.048, -8);
  root.add(mesh);
  const geometry = mesh.geometry;
  const vertices = Array.from(geometry.attributes.position.array);
  const look = applyJyotiReferenceExterior(root);
  assert.ok(look);
  assert.deepEqual(look.floorLevels, [0, 3.048, 6.0452, 9.0424, 12.0396, 15.0368, 18.034]);
  assert.equal(mesh.geometry, geometry);
  assert.deepEqual(Array.from(geometry.attributes.position.array), vertices);
  assert.deepEqual(mesh.position.toArray(), [11, 3.048, -8]);
  assert.equal(mesh.material.name, "Reference warm ivory plaster");
  const fixtures = [];
  look.details.traverse(node => {
    if (node.isMesh) {
      const bounds = new THREE.Box3().setFromObject(node);
      assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), node.name);
    }
    if (node.isPointLight) fixtures.push(node);
  });
  assert.equal(fixtures.length, 15);
  look.setNight(true);
  assert.ok(fixtures.every(light => light.intensity === 34));
  look.setNight(false);
  assert.ok(fixtures.every(light => light.intensity === 22));
  assert.equal(look.daylightSky.image.data.length, 512 * 256 * 4);
  assert.notDeepEqual(look.daylightSky.image.data, look.eveningSky.image.data);
  look.dispose();
});

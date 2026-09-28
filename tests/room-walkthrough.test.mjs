import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

// Execute the actual geometry builder; omit only browser image decoding.
const interiorScene = JSON.parse(
  fs.readFileSync('project-profiles/jyoti-paradise/interior-scene-v2.json', 'utf8'),
);
const source = fs.readFileSync('apps/public/src/viewer/projectExperience.ts', 'utf8')
  .replace('import * as THREE from "three";', `import * as THREE from ${JSON.stringify(import.meta.resolve('three'))};`)
  .replace('import { sourceTextureData } from "./sourceTextureData";', 'const sourceTextureData = {};')
  .replace(
    'import interiorScene from "../../../../project-profiles/jyoti-paradise/interior-scene-v2.json";',
    `const interiorScene = ${JSON.stringify(interiorScene)};`,
  );
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createJyotiProjectExperience } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const scene = createJyotiProjectExperience(new THREE.Box3(new THREE.Vector3(0, 0, -25), new THREE.Vector3(20, 28, 0)), false);
scene.root.updateMatrixWorld(true);

test('authored sites do not receive an invented second plot, gate or road', () => {
  const bounds = new THREE.Box3(new THREE.Vector3(0, 0, -25), new THREE.Vector3(20, 28, 0));
  const authored = createJyotiProjectExperience(bounds, false, true, true);
  assert.ok(!authored.features.some(feature => ['plot', 'parking', 'gate', 'road', 'landscape'].includes(feature.id)));
  assert.deepEqual(authored.focus('site').box, bounds);
  assert.ok(authored.rooms.length >= 29);
  authored.dispose();
});

test('all reconstructed rooms and balconies have finite eye-height entry points', () => {
  assert.ok(scene.rooms.length >= 29);
  for (const room of scene.rooms) {
    const entry = scene.roomEntry(room.id);
    assert.ok(entry && entry.point.toArray().every(Number.isFinite), room.id);
    assert.ok(entry.point.x > entry.bounds.min.x && entry.point.x < entry.bounds.max.x, room.id);
    assert.ok(entry.point.z > entry.bounds.min.z && entry.point.z < entry.bounds.max.z, room.id);
    assert.ok(Math.abs(entry.point.y - entry.bounds.max.y - 1.6 * entry.scale) < 1e-6);
  }
});

test('brochure rooms do not materially overlap each other', () => {
  for (let i = 0; i < scene.rooms.length; i++) for (let j = i + 1; j < scene.rooms.length; j++) {
    const a = scene.roomEntry(scene.rooms[i].id).bounds;
    const b = scene.roomEntry(scene.rooms[j].id).bounds;
    const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
    const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
    assert.ok(overlapX < 0.03 * scene.interiorScale || overlapZ < 0.03 * scene.interiorScale,
      `${scene.rooms[i].id} overlaps ${scene.rooms[j].id}`);
  }
});

test('walk mode raises walls and adds ceilings; plan mode restores cutaway', () => {
  scene.setWalk(true);
  let walls = 0;
  scene.root.traverse((object) => {
    if (object.userData.walkWall) { assert.equal(object.scale.y, 1); walls++; }
    if (object.userData.walkCeiling) assert.equal(object.visible, true);
  });
  assert.ok(walls > 50);
  scene.setWalk(false);
  scene.root.traverse((object) => {
    if (object.userData.walkWall) assert.ok(object.scale.y < 1);
    if (object.userData.walkCeiling) assert.equal(object.visible, false);
  });
});

test('walk controls release on cancellation, blur and hidden tab', () => {
  const viewer = fs.readFileSync('apps/public/src/viewer/Viewer3D.tsx', 'utf8');
  for (const token of ['onLostPointerCapture', 'onPointerCancel', 'visibilitychange', 'pointerTravel > 6', 'collisionRay.intersectObjects']) assert.ok(viewer.includes(token));
});

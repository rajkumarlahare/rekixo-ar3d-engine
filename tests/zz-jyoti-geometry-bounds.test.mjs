import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const PROJECT_URL =
  "https://ar3dstudio.in/3Dprojects/api/projects/jyoti-paradise-local-backup-302a8799";

function parseGlb(loader, buffer) {
  return new Promise((resolve, reject) => {
    loader.parse(buffer, "", resolve, reject);
  });
}

test("diagnose live Jyoti GLB world bounds and origin", async () => {
  const projectRes = await fetch(PROJECT_URL);
  assert.equal(projectRes.ok, true);
  const payload = await projectRes.json();
  const modelUrl = new URL(payload.model.url, PROJECT_URL).toString();

  const modelRes = await fetch(modelUrl);
  assert.equal(modelRes.ok, true);
  const buffer = await modelRes.arrayBuffer();

  const loader = new GLTFLoader();
  const gltf = await parseGlb(loader, buffer);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());

  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  let minRootDistance = Infinity;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    meshes += 1;
    const geometry = node.geometry;
    const position = geometry?.getAttribute?.("position");
    if (position) vertices += position.count;
    const index = geometry?.index;
    triangles += index ? index.count / 3 : position ? position.count / 3 : 0;
    const p = new THREE.Vector3();
    node.getWorldPosition(p);
    minRootDistance = Math.min(minRootDistance, p.length());
  });

  console.log(
    "JYOTI_GEOMETRY",
    JSON.stringify({
      bytes: buffer.byteLength,
      bounds: {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        center: center.toArray(),
        size: size.toArray(),
      },
      originToCenterM: center.length(),
      baseYOffsetM: bounds.min.y,
      meshes,
      vertices,
      triangles,
      minMeshOriginDistanceM: minRootDistance,
      root: {
        position: scene.position.toArray(),
        rotation: [scene.rotation.x, scene.rotation.y, scene.rotation.z],
        scale: scene.scale.toArray(),
      },
    }),
  );
});

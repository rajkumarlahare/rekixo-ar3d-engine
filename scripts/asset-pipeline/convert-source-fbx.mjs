import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Resolve the same Three version used by the viewer, including workspace installs.
const require = createRequire(new URL("../../apps/public/package.json", import.meta.url));
const THREE = await import(pathToFileURL(path.join(path.dirname(require.resolve("three")), "three.module.js")));
const { FBXLoader } = await import(pathToFileURL(require.resolve("three/examples/jsm/loaders/FBXLoader.js")));
const { GLTFExporter } = await import(pathToFileURL(require.resolve("three/examples/jsm/exporters/GLTFExporter.js")));

class BlobReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
}

export function consolidateMaterialGroups(geometry) {
  if (geometry.groups.length < 2) return;
  const batches = new Map();
  for (const group of geometry.groups) {
    const batch = batches.get(group.materialIndex) ?? [];
    for (let i = group.start; i < group.start + group.count; i++) {
      batch.push(geometry.index ? geometry.index.getX(i) : i);
    }
    batches.set(group.materialIndex, batch);
  }
  const indices = [];
  geometry.clearGroups();
  for (const [materialIndex, batch] of batches) {
    geometry.addGroup(indices.length, batch.length, materialIndex);
    for (const index of batch) indices.push(index);
  }
  geometry.setIndex(indices);
}

export async function convertSourceFbx(input, output, { authoredSite = false } = {}) {
  const bytes = await fs.readFile(input);
  const previousWindow = globalThis.window;
  const previousReader = globalThis.FileReader;
  globalThis.window = { URL };
  globalThis.FileReader = BlobReader;
  // External D5/SketchUp bitmaps are not embedded in this FBX. Keep material
  // names and UVs; the viewer restores its extracted source bitmap library.
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { setPath() { return this; }, load: () => new THREE.Texture() });
  try {
    const root = new FBXLoader(manager).parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "",
    );
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const materials = new Map();
    let meshCount = 0;
    let multiMaterialMeshes = 0;
    let triangleCount = 0;
    root.traverse((mesh) => {
      if (!mesh.isMesh) return;
      meshCount++;
      const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (original.length > 1) multiMaterialMeshes++;
      triangleCount += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
      consolidateMaterialGroups(mesh.geometry);
      const converted = original.map((source) => {
        if (!materials.has(source.uuid)) {
          const material = new THREE.MeshStandardMaterial({
            name: source.name, color: source.color, opacity: source.opacity,
            transparent: source.transparent, side: source.side,
            roughness: 0.72, metalness: 0,
          });
          materials.set(source.uuid, material);
        }
        return materials.get(source.uuid);
      });
      // Never flatten an FBX material array to its first item: geometry.groups
      // assigns the glazing, plaster, frames and cladding triangle by triangle.
      mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
    });
    root.userData.sourceGeometry = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      coordinatePolicy: "unchanged-source-coordinates",
      siteGeometry: authoredSite ? "included-in-source" : "unspecified",
    };
    const buffer = await new GLTFExporter().parseAsync(root, { binary: true });
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, Buffer.from(buffer));
    const report = {
      sourceSha256: root.userData.sourceGeometry.sha256,
      meshCount, multiMaterialMeshes, triangleCount, materialCount: materials.size,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      coordinatePolicy: "No rescaling, rotation, recentering or replacement geometry",
      textures: "UVs and material names retained; external bitmaps restored by viewer",
      bytes: buffer.byteLength,
    };
    await fs.writeFile(`${output}.json`, JSON.stringify(report, null, 2));
    return report;
  } finally {
    globalThis.window = previousWindow;
    globalThis.FileReader = previousReader;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [input, output, ...flags] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: node scripts/asset-pipeline/convert-source-fbx.mjs input.fbx output.glb");
  console.log(JSON.stringify(await convertSourceFbx(input, output, { authoredSite: flags.includes("--authored-site") }), null, 2));
}

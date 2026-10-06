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

export const FBX_SCALE_SANITY_POLICY = "broad-building-bounds-v1";
export const MIN_CANONICAL_BUILDING_MAX_DIMENSION_M = 2;
export const MAX_CANONICAL_BUILDING_MAX_DIMENSION_M = 2000;

class BlobReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
}

function invalidFbxUnitMetadata() {
  const error = new Error(
    "FBX GlobalSettings.UnitScaleFactor must be a finite positive centimetres-per-unit value.",
  );
  error.code = "FBX_UNIT_METADATA_INVALID";
  return error;
}

function scaleReviewRequired(details) {
  const dimensions = details.canonicalDimensionsM.map((value) => Number(value.toFixed(4))).join(" × ");
  const error = new Error(
    `FBX declared units produce implausible canonical Building bounds (${dimensions} m). Explicit scale review is required before canonicalization.`,
  );
  error.code = "FBX_SCALE_REVIEW_REQUIRED";
  error.details = details;
  return error;
}

export function metreScaleFromFbxUnitScaleFactor(unitScaleFactor) {
  const centimetresPerUnit = Number(unitScaleFactor);
  if (!Number.isFinite(centimetresPerUnit) || centimetresPerUnit <= 0) {
    throw invalidFbxUnitMetadata();
  }
  const metresPerUnit = centimetresPerUnit / 100;
  if (!Number.isFinite(metresPerUnit) || metresPerUnit <= 0) {
    throw invalidFbxUnitMetadata();
  }
  return metresPerUnit;
}

function finiteDimensions(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => Number.isFinite(Number(item)) && Number(item) >= 0)
  );
}

function boxDimensions(box) {
  if (!box || box.isEmpty()) return [0, 0, 0];
  const size = box.getSize(new THREE.Vector3());
  return [size.x, size.y, size.z];
}

export function assessCanonicalBuildingScale({
  rawDimensions,
  canonicalDimensionsM,
  sourceUnitScaleFactorCmPerUnit,
  appliedMetreScale,
}) {
  if (!finiteDimensions(rawDimensions) || !finiteDimensions(canonicalDimensionsM)) {
    return {
      status: "review-required",
      reason: "invalid-bounds",
      policy: FBX_SCALE_SANITY_POLICY,
      rawDimensions: Array.isArray(rawDimensions) ? rawDimensions : [0, 0, 0],
      canonicalDimensionsM: Array.isArray(canonicalDimensionsM)
        ? canonicalDimensionsM
        : [0, 0, 0],
      sourceUnitScaleFactorCmPerUnit,
      appliedMetreScale,
      minLargestDimensionM: MIN_CANONICAL_BUILDING_MAX_DIMENSION_M,
      maxLargestDimensionM: MAX_CANONICAL_BUILDING_MAX_DIMENSION_M,
    };
  }

  const largestDimensionM = Math.max(...canonicalDimensionsM.map(Number));
  let reason = null;
  if (largestDimensionM < MIN_CANONICAL_BUILDING_MAX_DIMENSION_M)
    reason = "canonical-bounds-too-small";
  else if (largestDimensionM > MAX_CANONICAL_BUILDING_MAX_DIMENSION_M)
    reason = "canonical-bounds-too-large";

  return {
    status: reason ? "review-required" : "pass",
    reason,
    policy: FBX_SCALE_SANITY_POLICY,
    rawDimensions: rawDimensions.map(Number),
    canonicalDimensionsM: canonicalDimensionsM.map(Number),
    largestDimensionM,
    sourceUnitScaleFactorCmPerUnit,
    appliedMetreScale,
    minLargestDimensionM: MIN_CANONICAL_BUILDING_MAX_DIMENSION_M,
    maxLargestDimensionM: MAX_CANONICAL_BUILDING_MAX_DIMENSION_M,
  };
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

export async function convertSourceFbx(
  input,
  output,
  { authoredSite = false, normalizeUnitsToMeters = false } = {},
) {
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
    const rawBounds = new THREE.Box3().setFromObject(root);
    const rawDimensions = boxDimensions(rawBounds);

    let sourceUnitScaleFactorCmPerUnit = null;
    let appliedMetreScale = 1;
    let outputUnits = "source";
    let scaleSanity = null;
    if (normalizeUnitsToMeters) {
      sourceUnitScaleFactorCmPerUnit = Number(root.userData?.unitScaleFactor);
      appliedMetreScale = metreScaleFromFbxUnitScaleFactor(sourceUnitScaleFactorCmPerUnit);
      root.scale.multiplyScalar(appliedMetreScale);
      // FBXLoader exposes the source UnitScaleFactor on the root. After the
      // canonical root scale is applied, keep the source value separately and
      // describe the exported coordinate unit as one metre per glTF unit.
      root.userData.sourceUnitScaleFactorCmPerUnit = sourceUnitScaleFactorCmPerUnit;
      root.userData.unitScaleFactor = 100;
      outputUnits = "metre";

      root.updateMatrixWorld(true);
      const candidateBounds = new THREE.Box3().setFromObject(root);
      scaleSanity = assessCanonicalBuildingScale({
        rawDimensions,
        canonicalDimensionsM: boxDimensions(candidateBounds),
        sourceUnitScaleFactorCmPerUnit,
        appliedMetreScale,
      });
      if (scaleSanity.status !== "pass") throw scaleReviewRequired(scaleSanity);
    }

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
      coordinatePolicy: normalizeUnitsToMeters
        ? "fbx-unit-scale-factor-normalized-to-metres"
        : "unchanged-source-coordinates",
      siteGeometry: authoredSite ? "included-in-source" : "unspecified",
      ...(normalizeUnitsToMeters
        ? {
            sourceUnitScaleFactorCmPerUnit,
            appliedMetreScale,
            outputUnits,
            scaleSanity,
          }
        : {}),
    };
    const buffer = await new GLTFExporter().parseAsync(root, { binary: true });
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, Buffer.from(buffer));
    const report = {
      sourceSha256: root.userData.sourceGeometry.sha256,
      meshCount, multiMaterialMeshes, triangleCount, materialCount: materials.size,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      rawBounds: { min: rawBounds.min.toArray(), max: rawBounds.max.toArray() },
      coordinatePolicy: normalizeUnitsToMeters
        ? "Uniform FBX UnitScaleFactor normalization to canonical metres; no recentering or replacement geometry"
        : "No rescaling, rotation, recentering or replacement geometry",
      unitPolicy: normalizeUnitsToMeters
        ? "FBX UnitScaleFactor centimetres-per-unit converted to metres"
        : "Source units preserved",
      sourceUnitScaleFactorCmPerUnit,
      appliedMetreScale,
      outputUnits,
      scaleSanity,
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
  console.log(JSON.stringify(await convertSourceFbx(input, output, {
    authoredSite: flags.includes("--authored-site"),
    normalizeUnitsToMeters: flags.includes("--canonical-metres"),
  }), null, 2));
}

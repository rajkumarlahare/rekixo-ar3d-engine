import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import {
  center,
  dedup,
  flatten,
  getBounds,
  join,
  palette,
  prune,
  simplify,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseGlbJson(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) fail("Invalid GLB magic.");
  if (view.getUint32(4, true) !== 2) fail("Only GLB 2.0 is supported.");
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4e4f534a) fail("First GLB chunk must be JSON.");
  const jsonBytes = bytes.slice(20, 20 + jsonLength);
  return JSON.parse(
    new TextDecoder().decode(jsonBytes).replace(/\u0000+$/g, "").trim(),
  );
}

async function geometryStats(buffer) {
  const io = new NodeIO();
  const document = await io.readBinary(new Uint8Array(buffer));
  const root = document.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  if (!scene) fail("Geo derivative has no scene.");

  const bounds = getBounds(scene);
  const min = [...bounds.min];
  const max = [...bounds.max];
  const centerPoint = min.map((value, index) => (value + max[index]) / 2);
  const size = min.map((value, index) => max[index] - value);

  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    meshes += 1;
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (position) vertices += position.getCount();
      const indices = primitive.getIndices();
      triangles += indices
        ? indices.getCount() / 3
        : position
          ? position.getCount() / 3
          : 0;
    }
  }

  return {
    bounds: { min, max, center: centerPoint, size },
    meshes,
    vertices,
    triangles,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "follow",
  });
  if (!response.ok) fail(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) fail(`GET ${url} failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function buildCandidate(sourcePath, outputPath, ratio, error) {
  const io = new NodeIO();
  const document = await io.read(sourcePath);

  const root = document.getRoot();
  const hasTextures = root.listTextures().length > 0;

  // Architectural/CAD exports often carry split vertex normals that prevent
  // meshoptimizer from collapsing geometry. For the map-only derivative we can
  // omit them: glTF normals are optional and the renderer can derive hard
  // surface normals. If the document has no textures, UV attributes are also
  // provably unused and can account for several megabytes of dead geometry
  // payload. The immutable source GLB remains untouched.
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitive.getAttribute("NORMAL")?.dispose();
      primitive.getAttribute("TANGENT")?.dispose();
      if (!hasTextures) {
        for (const semantic of primitive.listSemantics()) {
          if (semantic.startsWith("TEXCOORD_"))
            primitive.getAttribute(semantic)?.dispose();
        }
      }
    }
  }

  await MeshoptSimplifier.ready;
  await document.transform(
    center({ pivot: "below" }),
    weld(),
    dedup(),
    palette({ min: 2 }),
    prune({
      keepAttributes: false,
      keepIndices: false,
      keepLeaves: false,
      keepSolidTextures: false,
    }),
    // join() only combines sibling nodes; flatten the architectural scene
    // first so repeated CAD hierarchy does not keep hundreds of tiny meshes.
    flatten(),
    join({ keepNamed: false, keepMeshes: false }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio,
      error,
      lockBorder: false,
    }),
    prune({
      keepAttributes: false,
      keepIndices: false,
      keepLeaves: false,
      keepSolidTextures: false,
    }),
  );

  await io.write(outputPath, document);
  return fs.readFileSync(outputPath);
}

const slug = String(process.argv[2] || "").trim().toLowerCase();
const outputDir = path.resolve(process.argv[3] || "");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
  fail("Usage: node scripts/build-geo-model-derivative.mjs <project-slug> <output-dir>");
if (!outputDir) fail("Output directory is required.");

fs.mkdirSync(outputDir, { recursive: true });
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rekixo-geo-model-"));
const projectUrl =
  `https://ar3dstudio.in/3Dprojects/api/projects/${encodeURIComponent(slug)}`;
const payload = await fetchJson(projectUrl);
const model = payload?.model;
const release = payload?.release;
const project = payload?.project;
if (
  !project ||
  project.slug !== slug ||
  project.status !== "published" ||
  !release?.id ||
  !Number.isInteger(Number(release.version)) ||
  !model?.id ||
  model.mimeType !== "model/gltf-binary" ||
  !model.url
)
  fail("Published immutable Engine project/model contract is incomplete.");

const sourceUrl = new URL(model.url, projectUrl).toString();
const sourceBytes = await fetchBytes(sourceUrl);
const sourceJson = parseGlbJson(sourceBytes);
if ((sourceJson.extensionsRequired || []).length)
  fail("Source GLB requires unsupported glTF extensions.");

const sourcePath = path.join(workDir, "source.glb");
fs.writeFileSync(sourcePath, sourceBytes);

// Prefer a small core-GLB with few draw calls. Google recommends keeping
// complex map models around 5 MB when possible; 8 MB is our hard deployment
// ceiling so an optimization regression cannot silently ship a huge model.
const attempts = [
  { ratio: 0.45, error: 0.006 },
  { ratio: 0.32, error: 0.01 },
  { ratio: 0.22, error: 0.015 },
  { ratio: 0.14, error: 0.02 },
  { ratio: 0.09, error: 0.03 },
];

let chosen = null;
for (const attempt of attempts) {
  const candidatePath = path.join(
    workDir,
    `geo-${String(attempt.ratio).replace(".", "_")}.glb`,
  );
  const bytes = await buildCandidate(
    sourcePath,
    candidatePath,
    attempt.ratio,
    attempt.error,
  );
  const json = parseGlbJson(bytes);
  const extensionsUsed = json.extensionsUsed || [];
  const extensionsRequired = json.extensionsRequired || [];
  if (extensionsUsed.length || extensionsRequired.length) {
    console.log(
      "REKIXO_GEO_CANDIDATE_REJECTED",
      JSON.stringify({
        ratio: attempt.ratio,
        byteSize: bytes.byteLength,
        extensionsUsed,
        extensionsRequired,
      }),
    );
    continue;
  }

  const stats = await geometryStats(bytes);
  const candidate = { ...attempt, path: candidatePath, bytes, stats };
  console.log(
    "REKIXO_GEO_CANDIDATE",
    JSON.stringify({
      ratio: attempt.ratio,
      error: attempt.error,
      byteSize: bytes.byteLength,
      meshes: stats.meshes,
      vertices: stats.vertices,
      triangles: stats.triangles,
      bounds: stats.bounds,
    }),
  );

  if (
    !chosen ||
    candidate.bytes.byteLength < chosen.bytes.byteLength ||
    (candidate.bytes.byteLength === chosen.bytes.byteLength &&
      candidate.stats.meshes < chosen.stats.meshes)
  )
    chosen = candidate;

  if (bytes.byteLength <= 4_800_000 && stats.meshes <= 120) {
    chosen = candidate;
    break;
  }
}

if (!chosen) fail("Geo derivative was not generated.");

const geoJson = parseGlbJson(chosen.bytes);
const required = geoJson.extensionsRequired || [];
const used = geoJson.extensionsUsed || [];
if (required.length || used.length)
  fail(
    `Geo derivative must remain core glTF without extensions. used=${used.join(",")} required=${required.join(",")}`,
  );

const stats = chosen.stats;
const [cx, , cz] = stats.bounds.center;
const minY = stats.bounds.min[1];
if (Math.abs(cx) > 0.05 || Math.abs(cz) > 0.05 || Math.abs(minY) > 0.05)
  fail(
    `Geo derivative origin is not base-centered: center=${stats.bounds.center.join(",")} minY=${minY}`,
  );
if (chosen.bytes.byteLength > 8_000_000)
  fail(
    `Geo derivative is still too large for reliable map rendering: ${chosen.bytes.byteLength} bytes`,
  );
if (stats.meshes > 180)
  fail(
    `Geo derivative still has too many rendered meshes: ${stats.meshes}`,
  );

const releaseId = String(release.id);
const modelId = String(model.id);
const r2Base =
  `projects/${slug}/releases/${releaseId}/geo-models/${modelId}`;
const modelOut = path.join(outputDir, "model.glb");
const metadataOut = path.join(outputDir, "metadata.json");
fs.writeFileSync(modelOut, chosen.bytes);

const metadata = {
  format: "rekixo-geo-model-derivative",
  version: 1,
  pipeline: "core-map-v2",
  generator: "@gltf-transform/*@4.5.1",
  projectId: project.id,
  projectSlug: slug,
  releaseId,
  releaseVersion: Number(release.version),
  sourceModelId: modelId,
  sourceModelName: model.name,
  sourceUrl,
  sourceSha256: sha256(sourceBytes),
  sourceByteSize: sourceBytes.byteLength,
  geoSha256: sha256(chosen.bytes),
  geoByteSize: chosen.bytes.byteLength,
  simplifyRatio: chosen.ratio,
  simplifyError: chosen.error,
  extensionsUsed: used,
  extensionsRequired: required,
  stats,
  r2Key: `${r2Base}/model.glb`,
  metadataR2Key: `${r2Base}/metadata.json`,
};
fs.writeFileSync(metadataOut, JSON.stringify(metadata, null, 2) + "\n");
console.log("REKIXO_GEO_DERIVATIVE", JSON.stringify(metadata));

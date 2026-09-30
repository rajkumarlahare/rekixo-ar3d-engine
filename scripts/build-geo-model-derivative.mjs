import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const CLI = ["--yes", "@gltf-transform/cli@4.5.1"];

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

function runTransform(args) {
  execFileSync("npx", [...CLI, ...args], {
    stdio: "inherit",
    env: process.env,
  });
}

function parseGlb(loader, buffer) {
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      "",
      resolve,
      reject,
    );
  });
}

async function geometryStats(buffer) {
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
  scene.traverse((node) => {
    if (!node.isMesh) return;
    meshes += 1;
    const geometry = node.geometry;
    const position = geometry?.getAttribute?.("position");
    if (position) vertices += position.count;
    const index = geometry?.index;
    triangles += index ? index.count / 3 : position ? position.count / 3 : 0;
  });
  return {
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      center: center.toArray(),
      size: size.toArray(),
    },
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

const slug = String(process.argv[2] || "").trim().toLowerCase();
const outputDir = path.resolve(process.argv[3] || "");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
  fail("Usage: node scripts/build-geo-model-derivative.mjs <project-slug> <output-dir>");
if (!outputDir) fail("Output directory is required.");

fs.mkdirSync(outputDir, { recursive: true });
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rekixo-geo-model-"));
const projectUrl = `https://ar3dstudio.in/3Dprojects/api/projects/${encodeURIComponent(slug)}`;
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
const centeredPath = path.join(workDir, "centered.glb");
const weldedPath = path.join(workDir, "welded.glb");
const dedupPath = path.join(workDir, "dedup.glb");
const prunedPath = path.join(workDir, "pruned.glb");
const joinedPath = path.join(workDir, "joined.glb");
fs.writeFileSync(sourcePath, sourceBytes);

// Keep the derivative core-glTF-only: center and simplify geometry without
// adding Draco/Meshopt/KTX2/instancing extensions, because Google Maps 3D's
// Model3DElement supports .glb core PBR but does not guarantee arbitrary
// extension support.
runTransform(["center", sourcePath, centeredPath, "--pivot", "below"]);
runTransform(["weld", centeredPath, weldedPath]);
runTransform(["dedup", weldedPath, dedupPath]);
runTransform(["prune", dedupPath, prunedPath]);
runTransform(["join", prunedPath, joinedPath]);

const attempts = [
  { ratio: 0.35, error: 0.003 },
  { ratio: 0.25, error: 0.005 },
  { ratio: 0.18, error: 0.0075 },
  { ratio: 0.12, error: 0.01 },
  { ratio: 0.08, error: 0.015 },
];
let chosen = null;
for (const attempt of attempts) {
  const candidate = path.join(
    workDir,
    `geo-${String(attempt.ratio).replace(".", "_")}.glb`,
  );
  runTransform([
    "simplify",
    joinedPath,
    candidate,
    "--ratio",
    String(attempt.ratio),
    "--error",
    String(attempt.error),
    "--lock-border",
    "true",
  ]);
  const bytes = fs.readFileSync(candidate);
  chosen = { ...attempt, path: candidate, bytes };
  if (bytes.byteLength <= 4_800_000) break;
}

if (!chosen) fail("Geo derivative was not generated.");
const geoJson = parseGlbJson(chosen.bytes);
const required = geoJson.extensionsRequired || [];
const used = geoJson.extensionsUsed || [];
if (required.length || used.length)
  fail(
    `Geo derivative must remain core glTF without extensions. used=${used.join(",")} required=${required.join(",")}`,
  );

const stats = await geometryStats(chosen.bytes);
const [cx, , cz] = stats.bounds.center;
const minY = stats.bounds.min[1];
if (Math.abs(cx) > 0.05 || Math.abs(cz) > 0.05 || Math.abs(minY) > 0.05)
  fail(
    `Geo derivative origin is not base-centered: center=${stats.bounds.center.join(",")} minY=${minY}`,
  );
if (chosen.bytes.byteLength > 6_000_000)
  fail(
    `Geo derivative is still too large for reliable map rendering: ${chosen.bytes.byteLength} bytes`,
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
  generator: "@gltf-transform/cli@4.5.1",
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

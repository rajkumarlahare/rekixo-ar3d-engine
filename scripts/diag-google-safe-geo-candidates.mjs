import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import * as fn from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const slug = "jyoti-paradise-local-backup-302a8799";
const projectUrl = `https://ar3dstudio.in/3Dprojects/api/projects/${slug}`;
const projectResponse = await fetch(projectUrl);
if (!projectResponse.ok) throw new Error(`project ${projectResponse.status}`);
const payload = await projectResponse.json();
const sourceUrl = new URL(payload.model.url, projectUrl).toString();
const sourceResponse = await fetch(sourceUrl);
if (!sourceResponse.ok) throw new Error(`source ${sourceResponse.status}`);
const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());

console.log("GLTF_FUNCTION_EXPORTS", JSON.stringify({
  normals: typeof fn.normals,
  tangents: typeof fn.tangents,
  simplify: typeof fn.simplify,
  palette: typeof fn.palette,
}));

const work = fs.mkdtempSync(path.join(os.tmpdir(), "geo-safe-diag-"));
const sourcePath = path.join(work, "source.glb");
fs.writeFileSync(sourcePath, sourceBytes);

async function stats(document, bytes) {
  const root = document.getRoot();
  let meshes = 0, primitives = 0, vertices = 0, triangles = 0;
  let primitivesWithNormals = 0, primitivesWithoutNormals = 0;
  for (const mesh of root.listMeshes()) {
    meshes += 1;
    for (const primitive of mesh.listPrimitives()) {
      primitives += 1;
      const pos = primitive.getAttribute("POSITION");
      if (pos) vertices += pos.getCount();
      if (primitive.getAttribute("NORMAL")) primitivesWithNormals += 1;
      else primitivesWithoutNormals += 1;
      const idx = primitive.getIndices();
      triangles += idx ? idx.getCount()/3 : pos ? pos.getCount()/3 : 0;
    }
  }
  return {
    bytes: bytes.byteLength,
    meshes, primitives, vertices, triangles,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    primitivesWithNormals,
    primitivesWithoutNormals,
  };
}

async function build(name, {dropNormals, usePalette, regenerateNormals}) {
  const io = new NodeIO();
  const document = await io.read(sourcePath);
  const root = document.getRoot();
  const hasTextures = root.listTextures().length > 0;

  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (dropNormals) primitive.getAttribute("NORMAL")?.dispose();
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
  const transforms = [
    fn.center({pivot:"below"}),
    fn.weld(),
    fn.dedup(),
  ];
  if (usePalette) transforms.push(fn.palette({min:2}));
  transforms.push(
    fn.prune({keepAttributes:false, keepIndices:false, keepLeaves:false, keepSolidTextures:false}),
    fn.flatten(),
    fn.join({keepNamed:false, keepMeshes:false}),
    fn.simplify({simplifier:MeshoptSimplifier, ratio:0.45, error:0.006, lockBorder:false}),
  );
  if (regenerateNormals) {
    if (typeof fn.normals !== "function") throw new Error("normals() is not exported");
    transforms.push(fn.normals({overwrite:true}));
  }
  transforms.push(fn.prune({keepAttributes:false, keepIndices:false, keepLeaves:false, keepSolidTextures:false}));
  await document.transform(...transforms);

  const out = path.join(work, name + ".glb");
  await io.write(out, document);
  const bytes = fs.readFileSync(out);
  console.log("GEO_SAFE_CANDIDATE", JSON.stringify({
    name,
    ...(await stats(document, bytes)),
  }));
}

await build("preserve-normals-no-palette", {
  dropNormals:false,
  usePalette:false,
  regenerateNormals:false,
});

await build("current-like-no-palette", {
  dropNormals:true,
  usePalette:false,
  regenerateNormals:false,
});

if (typeof fn.normals === "function") {
  await build("regenerated-normals-no-palette", {
    dropNormals:true,
    usePalette:false,
    regenerateNormals:true,
  });
}

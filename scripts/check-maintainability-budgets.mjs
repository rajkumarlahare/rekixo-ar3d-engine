import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const lineCount = (path) => read(path).split(/\r?\n/).length;

const budgets = [
  ["apps/admin/src/source-pack/SourcePackReview.tsx", 500],
  ["apps/admin/src/studio/SceneCanvas.tsx", 2050],
  ["workers/admin-cloud.mjs", 2450],
];

for (const [path, maxLines] of budgets) {
  const lines = lineCount(path);
  if (lines > maxLines)
    throw new Error(
      `${path} exceeded maintainability ceiling: ${lines} > ${maxLines} lines`,
    );
}

const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
if (/public\/src\/viewer/.test(canvas))
  throw new Error("Admin presentation canvas must not import implementation code from apps/public.");
if (!/@rekixo\/3d-model-profiles/.test(canvas))
  throw new Error("Admin presentation canvas must use the shared model-profile package.");

const cloud = read("workers/admin-cloud.mjs");
if (!/from "\.\/project-deletion\.mjs"/.test(cloud))
  throw new Error("Admin cloud worker must delegate destructive cleanup.");
if (/async function hardDeleteAllProjects/.test(cloud))
  throw new Error("Destructive cleanup implementation returned to admin-cloud.mjs.");

const deletion = read("workers/project-deletion.mjs");
for (const token of [
  "activeDeletionJob",
  "deletionStatus",
  "hardDeleteAllProjects",
  "cleanup_pending",
  "db_cleanup_pending",
])
  if (!deletion.includes(token))
    throw new Error(`Project deletion module lost required contract: ${token}`);

const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
const broadPhase = viewer.indexOf("walkRaycastCandidates(");
const triangleRaycast = viewer.indexOf("collisionRay.intersectObjects(candidates");
if (broadPhase < 0 || triangleRaycast <= broadPhase)
  throw new Error("Viewer walk collision must broad-phase candidates before triangle raycasts.");

console.log(
  budgets
    .map(([path, maxLines]) => `${path}: ${lineCount(path)}/${maxLines} lines`)
    .join("\n"),
);

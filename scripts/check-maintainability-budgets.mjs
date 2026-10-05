import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const lineCount = (path) => read(path).split(/\r?\n/).length;

const budgets = [
  ["apps/admin/src/source-pack/SourcePackReview.tsx", 500],
  ["apps/admin/src/studio/PresentationCanvas.tsx", 900],
  ["workers/admin-cloud.mjs", 2450],
];

for (const [path, maxLines] of budgets) {
  const lines = lineCount(path);
  if (lines > maxLines)
    throw new Error(
      `${path} exceeded maintainability ceiling: ${lines} > ${maxLines} lines`,
    );
}

for (const retiredPath of [
  "apps/admin/src/studio/StudioOverview.tsx",
  "apps/admin/src/studio/StudioPublish.tsx",
  "apps/admin/src/studio/StudioSources.tsx",
  "apps/admin/src/studio/useStudioCloudState.ts",
  "apps/admin/src/studio/SceneCanvas.tsx",
  "apps/admin/src/studio/SceneCanvasOverlays.tsx",
  "apps/admin/src/studio/CanvasAuthoringHints.tsx",
  "apps/admin/src/studio/MaterialQuickEditor.tsx",
  "apps/admin/src/studio/ModelNodeInspector.tsx",
  "apps/admin/src/studio/ReferenceWorkspace.tsx",
])
  if (fs.existsSync(retiredPath))
    throw new Error(`Detached legacy Studio authoring surface returned: ${retiredPath}`);

const presentation = read("apps/admin/src/studio/PresentationCanvas.tsx");
if (/public\/src\/viewer/.test(presentation))
  throw new Error(
    "Admin presentation canvas must not import implementation code from apps/public.",
  );
if (!/@rekixo\/3d-model-profiles/.test(presentation))
  throw new Error(
    "Admin presentation canvas must use the shared model-profile package.",
  );
for (const forbidden of [
  "TransformControls",
  "sceneCanvasArchitectureController",
  "sceneCanvasEditorUx",
  "sceneCanvasDirectManipulation",
  "canvasFurniturePlacement",
  "sceneCanvasPlanResizeHandles",
  "SceneCanvasOverlays",
  "CanvasAuthoringHints",
])
  if (presentation.includes(forbidden))
    throw new Error(
      `Read-only PresentationCanvas regained authoring dependency: ${forbidden}`,
    );

const publishedViewer = read("apps/admin/src/studio/PublishedViewer.tsx");
if (!/from "\.\/PresentationCanvas"/.test(publishedViewer))
  throw new Error("PublishedViewer must use the read-only PresentationCanvas boundary.");
if (/from "\.\/SceneCanvas"/.test(publishedViewer))
  throw new Error("PublishedViewer must not depend on the retired authoring SceneCanvas shell.");

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
  throw new Error(
    "Viewer walk collision must broad-phase candidates before triangle raycasts.",
  );

console.log(
  budgets
    .map(([path, maxLines]) => `${path}: ${lineCount(path)}/${maxLines} lines`)
    .join("\n"),
);

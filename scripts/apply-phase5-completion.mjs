import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}
function write(path, content) {
  fs.writeFileSync(path, content);
}
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0)
    throw new Error(`Ambiguous patch anchor: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}
function replaceRange(source, startText, endText, replacement, label) {
  const start = source.indexOf(startText);
  if (start < 0) throw new Error(`Missing range start: ${label}`);
  const end = source.indexOf(endText, start);
  if (end < 0) throw new Error(`Missing range end: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

// visualFacadeMatching: keep this module data-URL-testable by avoiding a runtime import.
{
  const path = "apps/admin/src/studio/visualFacadeMatching.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    'import { referenceColorDistance } from "./referenceImagePalette";\n',
    "",
    "visual matching palette import",
  );
  const anchor = "const MATERIAL_CONFLICT_DISTANCE = 78;\n";
  source = replaceOnce(
    source,
    anchor,
    `${anchor}\nfunction referenceColorDistance(left: string, right: string) {\n  if (!/^#[0-9a-f]{6}$/i.test(left) || !/^#[0-9a-f]{6}$/i.test(right))\n    return Number.POSITIVE_INFINITY;\n  const a = [\n    Number.parseInt(left.slice(1, 3), 16),\n    Number.parseInt(left.slice(3, 5), 16),\n    Number.parseInt(left.slice(5, 7), 16),\n  ];\n  const b = [\n    Number.parseInt(right.slice(1, 3), 16),\n    Number.parseInt(right.slice(3, 5), 16),\n    Number.parseInt(right.slice(5, 7), 16),\n  ];\n  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);\n}\n`,
    "visual matching local color distance",
  );
  write(path, source);
}

// Domain schema + validation for spatial regions and multiple visual references.
{
  const path = "apps/admin/src/studio/domain.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    "export interface ReferenceImageEvidence {\n",
    `export interface ReferenceColorRegion {\n  id: string;\n  color: string;\n  coverage: number;\n  centroidX: number;\n  centroidY: number;\n  minX: number;\n  minY: number;\n  maxX: number;\n  maxY: number;\n  luminance: number;\n  saturation: number;\n  warmth: number;\n  edgeStrength: number;\n  confidence: number;\n}\n\nexport interface ReferenceImageEvidence {\n`,
    "domain region interface",
  );
  source = replaceOnce(
    source,
    "  renderedPalette: string[];\n  averageLuminance: number;\n",
    "  renderedPalette: string[];\n  regions?: ReferenceColorRegion[];\n  averageLuminance: number;\n",
    "domain evidence regions",
  );
  source = replaceOnce(
    source,
    "  referenceImageEvidence?: ReferenceImageEvidence;\n  materialOverrides?: MaterialOverride[];\n",
    "  referenceImageEvidence?: ReferenceImageEvidence;\n  referenceImageEvidenceSet?: ReferenceImageEvidence[];\n  materialOverrides?: MaterialOverride[];\n",
    "domain evidence set",
  );
  const validationAnchor = `const unique = (items: { id: string }[]) =>\n  new Set(items.map((i) => i.id)).size === items.length &&\n  items.every((i) => text(i.id, 100));\n`;
  source = replaceOnce(
    source,
    validationAnchor,
    `${validationAnchor}\nfunction validReferenceColorRegion(region: ReferenceColorRegion) {\n  return (\n    !!region &&\n    text(region.id, 100) &&\n    color(region.color) &&\n    number(region.coverage, 0.0001, 1) &&\n    number(region.centroidX, 0, 1) &&\n    number(region.centroidY, 0, 1) &&\n    number(region.minX, 0, 1) &&\n    number(region.minY, 0, 1) &&\n    number(region.maxX, 0, 1) &&\n    number(region.maxY, 0, 1) &&\n    region.minX <= region.centroidX &&\n    region.centroidX <= region.maxX &&\n    region.minY <= region.centroidY &&\n    region.centroidY <= region.maxY &&\n    number(region.luminance, 0, 1) &&\n    number(region.saturation, 0, 1) &&\n    number(region.warmth, -1, 1) &&\n    number(region.edgeStrength, 0, 1) &&\n    number(region.confidence, 0, 1)\n  );\n}\n\nfunction validReferenceImageEvidence(evidence: ReferenceImageEvidence) {\n  return (\n    !!evidence &&\n    text(evidence.assetId, 100) &&\n    Number.isInteger(evidence.sourceWidth) &&\n    number(evidence.sourceWidth, 2, 50000) &&\n    Number.isInteger(evidence.sourceHeight) &&\n    number(evidence.sourceHeight, 2, 50000) &&\n    Number.isInteger(evidence.sampledWidth) &&\n    number(evidence.sampledWidth, 2, 2000) &&\n    Number.isInteger(evidence.sampledHeight) &&\n    number(evidence.sampledHeight, 2, 2000) &&\n    Array.isArray(evidence.renderedPalette) &&\n    evidence.renderedPalette.length >= 1 &&\n    evidence.renderedPalette.length <= 8 &&\n    evidence.renderedPalette.every((entry) => color(entry)) &&\n    new Set(evidence.renderedPalette.map((entry) => entry.toLowerCase())).size ===\n      evidence.renderedPalette.length &&\n    (evidence.regions === undefined ||\n      (Array.isArray(evidence.regions) &&\n        evidence.regions.length <= 24 &&\n        new Set(evidence.regions.map((entry) => entry.id)).size ===\n          evidence.regions.length &&\n        evidence.regions.every(validReferenceColorRegion))) &&\n    number(evidence.averageLuminance, 0, 1) &&\n    number(evidence.warmFraction, 0, 1) &&\n    number(evidence.darkFraction, 0, 1) &&\n    number(evidence.highlightFraction, 0, 1) &&\n    number(evidence.averageSaturation, 0, 1) &&\n    number(evidence.verticalEdgeStrength, 0, 1) &&\n    number(evidence.horizontalEdgeStrength, 0, 1) &&\n    [\"day\", \"evening\", \"night\", \"unknown\"].includes(evidence.lightingMood) &&\n    number(evidence.confidence, 0, 1) &&\n    Number.isInteger(evidence.sampleCount) &&\n    number(evidence.sampleCount, 1, 1000000)\n  );\n}\n`,
    "domain evidence validator helper",
  );
  source = replaceRange(
    source,
    "  if (s.referenceImageEvidence !== undefined) {\n",
    "  if (s.materialOverrides !== undefined) {\n",
    `  if (\n    s.referenceImageEvidence !== undefined &&\n    !validReferenceImageEvidence(s.referenceImageEvidence)\n  )\n    throw Error(\"Invalid reference image evidence.\");\n  if (s.referenceImageEvidenceSet !== undefined) {\n    if (\n      !Array.isArray(s.referenceImageEvidenceSet) ||\n      s.referenceImageEvidenceSet.length < 1 ||\n      s.referenceImageEvidenceSet.length > 12 ||\n      new Set(s.referenceImageEvidenceSet.map((entry) => entry.assetId)).size !==\n        s.referenceImageEvidenceSet.length ||\n      s.referenceImageEvidenceSet.some(\n        (entry) => !validReferenceImageEvidence(entry),\n      )\n    )\n      throw Error(\"Invalid reference image evidence set.\");\n  }\n`,
    "domain evidence validation block",
  );
  const assetAnchor = `    if (\n      s.referenceImageEvidence &&\n      !p.assets.includes(s.referenceImageEvidence.assetId)\n    )\n      throw Error(\"Reference image evidence asset is missing.\");\n`;
  source = replaceOnce(
    source,
    assetAnchor,
    `${assetAnchor}    for (const evidence of s.referenceImageEvidenceSet ?? [])\n      if (!p.assets.includes(evidence.assetId))\n        throw Error(\"Reference image evidence-set asset is missing.\");\n`,
    "domain evidence-set asset binding",
  );
  write(path, source);
}

// Cloud draft validation mirrors the browser schema.
{
  const path = "workers/studio-draft-validation.mjs";
  let source = read(path);
  const anchor = `const uniqueIds = (items, max = 100) =>\n  Array.isArray(items) &&\n  items.length <= max &&\n  new Set(items.map((item) => item?.id)).size === items.length &&\n  items.every((item) => item && text(item.id, 100));\n`;
  source = replaceOnce(
    source,
    anchor,
    `${anchor}\nfunction validReferenceRegion(region) {\n  return (\n    region && typeof region === \"object\" && !Array.isArray(region) &&\n    text(region.id, 100) && color(region.color) &&\n    number(region.coverage, 0.0001, 1) &&\n    number(region.centroidX, 0, 1) && number(region.centroidY, 0, 1) &&\n    number(region.minX, 0, 1) && number(region.minY, 0, 1) &&\n    number(region.maxX, 0, 1) && number(region.maxY, 0, 1) &&\n    region.minX <= region.centroidX && region.centroidX <= region.maxX &&\n    region.minY <= region.centroidY && region.centroidY <= region.maxY &&\n    number(region.luminance, 0, 1) && number(region.saturation, 0, 1) &&\n    number(region.warmth, -1, 1) && number(region.edgeStrength, 0, 1) &&\n    number(region.confidence, 0, 1)\n  );\n}\nfunction validReferenceEvidence(evidence, assetIds) {\n  return (\n    evidence && typeof evidence === \"object\" && !Array.isArray(evidence) &&\n    assetIds.has(evidence.assetId) &&\n    Number.isInteger(evidence.sourceWidth) && number(evidence.sourceWidth, 2, 50000) &&\n    Number.isInteger(evidence.sourceHeight) && number(evidence.sourceHeight, 2, 50000) &&\n    Number.isInteger(evidence.sampledWidth) && number(evidence.sampledWidth, 2, 2000) &&\n    Number.isInteger(evidence.sampledHeight) && number(evidence.sampledHeight, 2, 2000) &&\n    Array.isArray(evidence.renderedPalette) && evidence.renderedPalette.length >= 1 &&\n    evidence.renderedPalette.length <= 8 && evidence.renderedPalette.every(color) &&\n    new Set(evidence.renderedPalette.map((entry) => String(entry).toLowerCase())).size === evidence.renderedPalette.length &&\n    (evidence.regions === undefined || (Array.isArray(evidence.regions) && evidence.regions.length <= 24 &&\n      new Set(evidence.regions.map((entry) => entry?.id)).size === evidence.regions.length &&\n      evidence.regions.every(validReferenceRegion))) &&\n    number(evidence.averageLuminance, 0, 1) && number(evidence.warmFraction, 0, 1) &&\n    number(evidence.darkFraction, 0, 1) && number(evidence.highlightFraction, 0, 1) &&\n    number(evidence.averageSaturation, 0, 1) && number(evidence.verticalEdgeStrength, 0, 1) &&\n    number(evidence.horizontalEdgeStrength, 0, 1) &&\n    [\"day\", \"evening\", \"night\", \"unknown\"].includes(evidence.lightingMood) &&\n    number(evidence.confidence, 0, 1) && Number.isInteger(evidence.sampleCount) &&\n    number(evidence.sampleCount, 1, 1000000)\n  );\n}\n`,
    "worker evidence helper",
  );
  source = replaceRange(
    source,
    "  if (scene.referenceImageEvidence !== undefined) {\n",
    "  for (const floor of scene.floors)\n",
    `  if (\n    scene.referenceImageEvidence !== undefined &&\n    !validReferenceEvidence(scene.referenceImageEvidence, assetIds)\n  )\n    throw Error(\"Invalid Studio reference image evidence.\");\n  if (scene.referenceImageEvidenceSet !== undefined) {\n    if (\n      !Array.isArray(scene.referenceImageEvidenceSet) ||\n      scene.referenceImageEvidenceSet.length < 1 ||\n      scene.referenceImageEvidenceSet.length > 12 ||\n      new Set(scene.referenceImageEvidenceSet.map((entry) => entry?.assetId)).size !==\n        scene.referenceImageEvidenceSet.length ||\n      scene.referenceImageEvidenceSet.some(\n        (entry) => !validReferenceEvidence(entry, assetIds),\n      )\n    )\n      throw Error(\"Invalid Studio reference image evidence set.\");\n  }\n\n`,
    "worker evidence validation block",
  );
  write(path, source);
}

// AutoBuild analyzes every visual reference and retains a deterministic primary.
{
  const path = "apps/admin/src/studio/autoBuildPipelineLegacy.ts";
  let source = read(path);
  const importAnchor = `import {\n  inspectReferenceImage,\n  looksLikeGeneratedPlanReference,\n} from \"./referenceImageInspector\";\n`;
  source = replaceOnce(
    source,
    importAnchor,
    `${importAnchor}import { choosePrimaryVisualReference } from \"./visualFacadeMatching\";\n`,
    "legacy visual primary import",
  );
  source = replaceOnce(
    source,
    "    referenceImageEvidenceReady: boolean;\n    referencePaletteColors: number;\n",
    "    referenceImageEvidenceReady: boolean;\n    referenceImagesAnalyzed: number;\n    referenceImageRegions: number;\n    referencePaletteColors: number;\n",
    "legacy summary visual counts type",
  );
  source = replaceRange(
    source,
    "  const visualSourceIds = new Set(\n",
    "  const draft = buildSmartSceneDraft(next, analysis);\n",
    `  const visualSourceIds = new Set(\n    analysis.sources\n      .filter((source) => source.role === \"visual\")\n      .map((source) => source.assetId),\n  );\n  const visualReferences = workingFiles\n    .filter(\n      (file) =>\n        visualSourceIds.has(file.id) &&\n        !looksLikeGeneratedPlanReference(file.name) &&\n        /\\.(?:png|jpe?g|webp|bmp)$/i.test(file.name),\n    )\n    .sort(\n      (left, right) =>\n        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),\n    );\n  const analyzedVisualEvidence = [];\n  for (const visualReference of visualReferences) {\n    try {\n      const evidence = await inspectReferenceImage(visualReference);\n      if (evidence.confidence >= 0.45) analyzedVisualEvidence.push(evidence);\n      else\n        issues.push(\n          \`Reference image ${"${visualReference.name}"} decoded, but confidence ${"${Math.round(evidence.confidence * 100)}"}% is too low to retain as automatic appearance evidence.\`,\n        );\n    } catch (error) {\n      issues.push(\n        error instanceof Error\n          ? \`Reference image analysis (${"${visualReference.name}"}): ${"${error.message}"}\`\n          : \`Reference image analysis (${"${visualReference.name}"}) could not complete.\`,\n      );\n    }\n  }\n  const primaryVisualEvidence = choosePrimaryVisualReference(analyzedVisualEvidence);\n  if (primaryVisualEvidence) {\n    next = {\n      ...next,\n      scene: {\n        ...next.scene,\n        referenceImageEvidence: primaryVisualEvidence,\n        referenceImageEvidenceSet: analyzedVisualEvidence,\n      },\n    };\n    if (analyzedVisualEvidence.length > 1)\n      issues.push(\n        \`${"${analyzedVisualEvidence.length}"} visual reference images were analyzed. Rekixo selected a deterministic primary and preserved every reference for conflict-aware appearance review.\`,\n      );\n  }\n\n`,
    "legacy multi-reference analysis",
  );
  source = replaceOnce(
    source,
    `      referenceImageEvidenceReady: Boolean(\n        next.scene.referenceImageEvidence,\n      ),\n      referencePaletteColors:\n`,
    `      referenceImageEvidenceReady: Boolean(\n        next.scene.referenceImageEvidence,\n      ),\n      referenceImagesAnalyzed:\n        next.scene.referenceImageEvidenceSet?.length ??\n        (next.scene.referenceImageEvidence ? 1 : 0),\n      referenceImageRegions:\n        next.scene.referenceImageEvidenceSet?.reduce(\n          (sum, evidence) => sum + (evidence.regions?.length ?? 0),\n          0,\n        ) ?? next.scene.referenceImageEvidence?.regions?.length ?? 0,\n      referencePaletteColors:\n`,
    "legacy visual summary values",
  );
  source = replaceOnce(
    source,
    `  const referenceImage = summary.referenceImageEvidenceReady\n    ? \` · reference image: ${"${summary.referenceLightingMood || \"unknown\"}"} · ${"${summary.referencePaletteColors}"} rendered palette color${"${summary.referencePaletteColors === 1 ? \"\" : \"s\"}"} · visual structure evidence ready\`\n    : \"\";\n`,
    `  const referenceImage = summary.referenceImageEvidenceReady\n    ? \` · reference image: ${"${summary.referenceLightingMood || \"unknown\"}"} · ${"${summary.referenceImagesAnalyzed}"} visual reference${"${summary.referenceImagesAnalyzed === 1 ? \"\" : \"s\"}"} analyzed · ${"${summary.referenceImageRegions}"} color region${"${summary.referenceImageRegions === 1 ? \"\" : \"s\"}"} · ${"${summary.referencePaletteColors}"} rendered palette color${"${summary.referencePaletteColors === 1 ? \"\" : \"s\"}\`\n    : \"\";\n`,
    "legacy visual summary message",
  );
  write(path, source);
}

// Top-level AutoBuild summary exposes the completed Phase 5 evidence/arbitration state.
{
  const path = "apps/admin/src/studio/autoBuildPipeline.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    `    : \` · Phase 5 visual ${"${visual.status}"}${"${visual.appearance ? ` · appearance ${visual.appearance.status}` : \"\"}"}${"${visual.counts.suggestedMaterials ? ` · ${visual.counts.suggestedMaterials} source material suggestion${visual.counts.suggestedMaterials === 1 ? \"\" : \"s\"} for review` : \"\"}"}\`;\n`,
    `    : \` · Phase 5 visual ${"${visual.status}"} · ${"${visual.counts.references}"} reference${"${visual.counts.references === 1 ? \"\" : \"s\"}"} · ${"${visual.counts.regions}"} region${"${visual.counts.regions === 1 ? \"\" : \"s\"}"}${"${visual.appearance ? ` · appearance ${visual.appearance.status}` : \"\"}"}${"${visual.counts.regionMatches ? ` · ${visual.counts.regionMatches} region material match${visual.counts.regionMatches === 1 ? \"\" : \"es\"}` : \"\"}"}${"${visual.counts.conflicts ? ` · ${visual.counts.conflicts} visual conflict${visual.counts.conflicts === 1 ? \"\" : \"s\"}` : \"\"}"}${"${visual.counts.suggestedMaterials ? ` · ${visual.counts.suggestedMaterials} source material suggestion${visual.counts.suggestedMaterials === 1 ? \"\" : \"s\"} for review` : \"\"}"}\`;\n`,
    "top-level visual summary",
  );
  write(path, source);
}

// Capture an editor-clean current render for appearance-only visual difference scoring.
{
  const path = "apps/admin/src/studio/SceneCanvas.tsx";
  let source = read(path);
  const importAnchor = `import { asset } from \"./storage\";\n`;
  source = replaceOnce(
    source,
    importAnchor,
    `${importAnchor}import {\n  analyzeReferencePixels,\n  type ReferencePixelAnalysis,\n} from \"./referenceImagePalette\";\n`,
    "SceneCanvas visual sample import",
  );
  source = replaceOnce(
    source,
    `  onModelMaterials?: (materials: ModelMaterialSummary[]) => void;\n  cameraOrientation?: \"perspective\" | \"top\";\n`,
    `  onModelMaterials?: (materials: ModelMaterialSummary[]) => void;\n  visualSampleRequest?: number;\n  onVisualSample?: (sample: ReferencePixelAnalysis) => void;\n  onVisualSampleError?: (message: string) => void;\n  cameraOrientation?: \"perspective\" | \"top\";\n`,
    "SceneCanvas visual sample props",
  );
  const effectAnchor = `  useEffect(() => {\n    const r = api.current;\n    if (!r) return;\n    const alignment = props.scene.modelTransform ?? {\n`;
  const sampleEffect = `  useEffect(() => {\n    if (!props.visualSampleRequest || props.view !== \"building\") return;\n    const runtime = api.current;\n    if (!runtime || !runtime.model.children.length) {\n      props.onVisualSampleError?.(\"Load the building model before scoring the current view.\");\n      return;\n    }\n    const helper = runtime.transform.getHelper();\n    const visibility = [\n      [runtime.grid, runtime.grid.visible],\n      [runtime.references, runtime.references.visible],\n      [helper, helper.visible],\n      [runtime.roomDraft, runtime.roomDraft.visible],\n      [runtime.wallDraft, runtime.wallDraft.visible],\n      [runtime.polygonDraft, runtime.polygonDraft.visible],\n      [runtime.polygonEdit, runtime.polygonEdit.visible],\n      [runtime.multiSelection, runtime.multiSelection.visible],\n      ...(runtime.modelSelection\n        ? [[runtime.modelSelection, runtime.modelSelection.visible]]\n        : []),\n    ] as Array<[T.Object3D, boolean]>;\n    try {\n      for (const [object] of visibility) object.visible = false;\n      runtime.renderer.render(runtime.scene, runtime.camera);\n      const source = runtime.renderer.domElement;\n      const maxEdge = 640;\n      const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));\n      const width = Math.max(2, Math.round(source.width * scale));\n      const height = Math.max(2, Math.round(source.height * scale));\n      const canvas = document.createElement(\"canvas\");\n      canvas.width = width;\n      canvas.height = height;\n      const context = canvas.getContext(\"2d\", { willReadFrequently: true });\n      if (!context) throw Error(\"Rendered-view comparison canvas is unavailable.\");\n      context.drawImage(source, 0, 0, width, height);\n      const pixels = context.getImageData(0, 0, width, height);\n      props.onVisualSample?.(analyzeReferencePixels(pixels.data, width, height));\n    } catch (reason) {\n      props.onVisualSampleError?.(\n        reason instanceof Error\n          ? reason.message\n          : \"Current rendered view could not be analyzed.\",\n      );\n    } finally {\n      for (const [object, visible] of visibility) object.visible = visible;\n      runtime.renderer.render(runtime.scene, runtime.camera);\n    }\n  }, [props.visualSampleRequest]);\n\n`;
  source = replaceOnce(
    source,
    effectAnchor,
    sampleEffect + effectAnchor,
    "SceneCanvas visual sample effect",
  );
  write(path, source);
}

// Studio wires score requests/results to the live SceneCanvas and review panel.
{
  const path = "apps/admin/src/studio/Studio.tsx";
  let source = read(path);
  const importAnchor = `import { applyTransformCommit } from \"./sceneTransformApply\";\n`;
  source = replaceOnce(
    source,
    importAnchor,
    `${importAnchor}import {\n  compareVisualAppearance,\n  type VisualDifferenceResult,\n} from \"./visualDifference\";\n`,
    "Studio visual difference import",
  );
  source = replaceOnce(
    source,
    `  const [sourceAudits, setSourceAudits] = useState<FbxSourceAudit[]>([]);\n  const [sourceAuditBusy, setSourceAuditBusy] = useState(false);\n`,
    `  const [sourceAudits, setSourceAudits] = useState<FbxSourceAudit[]>([]);\n  const [sourceAuditBusy, setSourceAuditBusy] = useState(false);\n  const [visualSampleRequest, setVisualSampleRequest] = useState(0);\n  const [visualScoreBusy, setVisualScoreBusy] = useState(false);\n  const [visualDifference, setVisualDifference] =\n    useState<VisualDifferenceResult>();\n`,
    "Studio visual score state",
  );
  source = replaceOnce(
    source,
    `    setModelMaterials([]);\n    setSelectedMaterial(\"\");\n    setFurniturePlacementKind(undefined);\n`,
    `    setModelMaterials([]);\n    setSelectedMaterial(\"\");\n    setVisualSampleRequest(0);\n    setVisualScoreBusy(false);\n    setVisualDifference(undefined);\n    setFurniturePlacementKind(undefined);\n`,
    "Studio visual score reset",
  );
  source = replaceOnce(
    source,
    `  function edit(next: Project) {\n    if (!project) return;\n    setBackup(undefined);\n`,
    `  function edit(next: Project) {\n    if (!project) return;\n    setBackup(undefined);\n    setVisualDifference(undefined);\n    setVisualScoreBusy(false);\n`,
    "Studio invalidate score on edit",
  );
  const applyAnchor = `  function applyReferenceLook(action: VisualReviewAction) {\n    if (review || busy || sourceAuditBusy) return;\n    const next = applyVisualFacadeReview(p, sourceAudits, modelMaterials.map((material) => material.name), action);\n    if (next === p) return;\n    edit(next);\n    setMessage(\"Reviewed reference look applied. Use Undo to restore the previous look.\");\n  }\n`;
  source = replaceOnce(
    source,
    applyAnchor,
    `${applyAnchor}  function requestVisualDifferenceScore() {\n    if (!p.scene.referenceImageEvidence) {\n      setError(\"Analyze a visual reference before scoring the current view.\");\n      return;\n    }\n    setVisualDifference(undefined);\n    setVisualScoreBusy(true);\n    setVisualSampleRequest((value) => value + 1);\n  }\n`,
    "Studio visual score request",
  );
  source = replaceOnce(
    source,
    `            onModelNodes={setModelNodes}\n            onModelMaterials={setModelMaterials}\n          />\n`,
    `            onModelNodes={setModelNodes}\n            onModelMaterials={setModelMaterials}\n            visualSampleRequest={visualSampleRequest}\n            onVisualSample={(sample) => {\n              const reference = p.scene.referenceImageEvidence;\n              setVisualScoreBusy(false);\n              if (!reference) return;\n              setVisualDifference(\n                compareVisualAppearance(reference, sample, { viewpointAligned: true }),\n              );\n            }}\n            onVisualSampleError={(reason) => {\n              setVisualScoreBusy(false);\n              setError(reason);\n            }}\n          />\n`,
    "Studio SceneCanvas visual sample wiring",
  );
  source = replaceOnce(
    source,
    `              referenceName={files.find((file) => file.id === p.scene.referenceImageEvidence?.assetId)?.name}\n              disabled={Boolean(review) || busy || sourceAuditBusy}\n              onApply={applyReferenceLook}\n`,
    `              referenceNames={Object.fromEntries(files.map((file) => [file.id, file.name]))}\n              disabled={Boolean(review) || busy || sourceAuditBusy}\n              onApply={applyReferenceLook}\n              onScoreRequest={requestVisualDifferenceScore}\n              visualDifference={visualDifference}\n              scoreBusy={visualScoreBusy}\n`,
    "Studio visual review scoring props",
  );
  write(path, source);
}

// Deterministic replay includes all retained visual evidence and region boundaries.
{
  const path = "apps/admin/src/studio/sceneReplayFingerprint.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    "  Project,\n  Room,\n",
    "  Project,\n  ReferenceImageEvidence,\n  Room,\n",
    "fingerprint evidence type import",
  );
  const helperAnchor = `async function sha256(value: string) {\n`;
  const helper = `function referenceEvidenceSeed(\n  evidence: ReferenceImageEvidence,\n  assetRef: (id?: string) => string | undefined,\n) {\n  return {\n    source: assetRef(evidence.assetId),\n    palette: [...evidence.renderedPalette].map((row) => row.toLowerCase()).sort(),\n    regions: [...(evidence.regions ?? [])]\n      .sort((left, right) => left.id.localeCompare(right.id))\n      .map((region) => ({\n        id: region.id,\n        color: region.color.toLowerCase(),\n        coverage: round(region.coverage),\n        centroidX: round(region.centroidX),\n        centroidY: round(region.centroidY),\n        minX: round(region.minX),\n        minY: round(region.minY),\n        maxX: round(region.maxX),\n        maxY: round(region.maxY),\n        confidence: round(region.confidence),\n      })),\n    averageLuminance: round(evidence.averageLuminance),\n    warmFraction: round(evidence.warmFraction),\n    darkFraction: round(evidence.darkFraction),\n    highlightFraction: round(evidence.highlightFraction),\n    averageSaturation: round(evidence.averageSaturation),\n    verticalEdgeStrength: round(evidence.verticalEdgeStrength),\n    horizontalEdgeStrength: round(evidence.horizontalEdgeStrength),\n    lightingMood: evidence.lightingMood,\n    confidence: round(evidence.confidence),\n  };\n}\n\n`;
  source = replaceOnce(
    source,
    helperAnchor,
    helper + helperAnchor,
    "fingerprint evidence helper",
  );
  source = replaceRange(
    source,
    "    referenceImageEvidence: project.scene.referenceImageEvidence\n",
    "    floors: normalizedFloors,\n",
    `    referenceImageEvidence: project.scene.referenceImageEvidence\n      ? referenceEvidenceSeed(project.scene.referenceImageEvidence, assetRef)\n      : undefined,\n    referenceImageEvidenceSet: sortByCanonical(\n      project.scene.referenceImageEvidenceSet ?? [],\n      (evidence) => referenceEvidenceSeed(evidence, assetRef),\n    ).map((evidence) => referenceEvidenceSeed(evidence, assetRef)),\n`,
    "fingerprint visual evidence serialization",
  );
  write(path, source);
}

// Protected real-pack E2E now proves that actual visual bytes produce region evidence in Studio.
{
  const path = "e2e/golden-source-pack.spec.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    `    await page.getByTestId(\"open-visual-editor\").click();\n    await expect(page.getByLabel(\"3D editor tools\")).toBeVisible({ timeout: 60_000 });\n`,
    `    await page.getByTestId(\"open-visual-editor\").click();\n    await expect(page.getByLabel(\"3D editor tools\")).toBeVisible({ timeout: 60_000 });\n    const visualReview = page.getByTestId(\"visual-facade-review\");\n    await expect(visualReview).toBeVisible({ timeout: 60_000 });\n    await visualReview.locator(\"summary\").click();\n    await expect(page.getByTestId(\"visual-reference-summary\")).toContainText(\n      /[1-9]\\d* color region/i,\n      { timeout: 60_000 },\n    );\n`,
    "golden Phase 5 region proof",
  );
  write(path, source);
}

// Roadmap reflects implementation-complete Phase 5, with protected certification still required.
{
  const path = "docs/PERFECTION-ROADMAP-NEXT.md";
  let source = read(path);
  source = source.replace(
    "These are palette/name heuristics, not facade-region correspondence. Converted GLB and other models without an audit for the active asset have no automatic material application in this slice. Region correspondence, multiple-reference arbitration, visual-difference scoring and protected real-pack certification remain pending. The browser review test uses seeded analyzed evidence and verifies lighting apply/undo/redo/reload; it does not certify image recognition or the real six-file pack.",
    "Phase 5 implementation now includes deterministic spatial color-region evidence, conflict-aware multiple-reference arbitration, explicit reference-region-to-audited-material review, and an aligned-current-view appearance difference score. The score is presentation-only: camera, sky/background and occlusion affect it, and it never becomes dimensional or structural truth. Converted GLB and other models without an audit for the active asset still have no automatic material application. Protected real six-file certification remains the final Phase 5 gate.",
  );
  source = source.replace(
    "6. Add facade-region segmentation/correspondence, multiple-reference arbitration and visual-difference scoring without weakening metric-source authority.",
    "6. ✅ Add deterministic facade color-region correspondence, multiple-reference arbitration and aligned-view visual-difference scoring without weakening metric-source authority.",
  );
  source = source.replace(
    "7. Surface the visual plan in Studio as actionable review/apply controls, then include accepted runtime appearance/material overrides in deterministic replay.",
    "7. ✅ Surface the visual plan in Studio as actionable region review/apply controls; accepted runtime appearance/material overrides and retained reference evidence participate in deterministic replay.",
  );
  write(path, source);
}

console.log("Phase 5 completion wiring applied.");

import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const write = (path, content) => fs.writeFileSync(path, content);
function replaceOnce(source, from, to, label) {
  const at = source.indexOf(from);
  if (at < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(from, at + from.length) >= 0)
    throw new Error(`Ambiguous patch anchor: ${label}`);
  return source.slice(0, at) + to + source.slice(at + from.length);
}
function replaceRange(source, startText, endText, replacement, label) {
  const start = source.indexOf(startText);
  if (start < 0) throw new Error(`Missing range start: ${label}`);
  const end = source.indexOf(endText, start);
  if (end < 0) throw new Error(`Missing range end: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

// Keep visualFacadeMatching data-URL-testable (existing unit-test pattern).
{
  const path = "apps/admin/src/studio/visualFacadeMatching.ts";
  let s = read(path);
  s = replaceOnce(s, 'import { referenceColorDistance } from "./referenceImagePalette";\n', "", "visual runtime import");
  s = replaceOnce(
    s,
    "const MATERIAL_CONFLICT_DISTANCE = 78;\n",
    `const MATERIAL_CONFLICT_DISTANCE = 78;\n\nfunction referenceColorDistance(left: string, right: string) {\n  if (!/^#[0-9a-f]{6}$/i.test(left) || !/^#[0-9a-f]{6}$/i.test(right))\n    return Number.POSITIVE_INFINITY;\n  const a = [\n    Number.parseInt(left.slice(1, 3), 16),\n    Number.parseInt(left.slice(3, 5), 16),\n    Number.parseInt(left.slice(5, 7), 16),\n  ];\n  const b = [\n    Number.parseInt(right.slice(1, 3), 16),\n    Number.parseInt(right.slice(3, 5), 16),\n    Number.parseInt(right.slice(5, 7), 16),\n  ];\n  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);\n}\n`,
    "visual local color distance",
  );
  write(path, s);
}

// Scene schema: optional spatial regions + a bounded evidence set, while retaining the old primary field.
{
  const path = "apps/admin/src/studio/domain.ts";
  let s = read(path);
  s = replaceOnce(
    s,
    "export interface ReferenceImageEvidence {\n",
    `export interface ReferenceColorRegion {\n  id: string;\n  color: string;\n  coverage: number;\n  centroidX: number;\n  centroidY: number;\n  minX: number;\n  minY: number;\n  maxX: number;\n  maxY: number;\n  luminance: number;\n  saturation: number;\n  warmth: number;\n  edgeStrength: number;\n  confidence: number;\n}\n\nexport interface ReferenceImageEvidence {\n`,
    "domain region type",
  );
  s = replaceOnce(s, "  renderedPalette: string[];\n  averageLuminance: number;\n", "  renderedPalette: string[];\n  regions?: ReferenceColorRegion[];\n  averageLuminance: number;\n", "domain regions field");
  s = replaceOnce(s, "  referenceImageEvidence?: ReferenceImageEvidence;\n  materialOverrides?: MaterialOverride[];\n", "  referenceImageEvidence?: ReferenceImageEvidence;\n  referenceImageEvidenceSet?: ReferenceImageEvidence[];\n  materialOverrides?: MaterialOverride[];\n", "domain evidence set field");
  const uniqueAnchor = `const unique = (items: { id: string }[]) =>\n  new Set(items.map((i) => i.id)).size === items.length &&\n  items.every((i) => text(i.id, 100));\n`;
  s = replaceOnce(
    s,
    uniqueAnchor,
    uniqueAnchor + `\nfunction validReferenceColorRegion(region: ReferenceColorRegion) {\n  return (\n    !!region && text(region.id, 100) && color(region.color) &&\n    number(region.coverage, 0.0001, 1) &&\n    number(region.centroidX, 0, 1) && number(region.centroidY, 0, 1) &&\n    number(region.minX, 0, 1) && number(region.minY, 0, 1) &&\n    number(region.maxX, 0, 1) && number(region.maxY, 0, 1) &&\n    region.minX <= region.centroidX && region.centroidX <= region.maxX &&\n    region.minY <= region.centroidY && region.centroidY <= region.maxY &&\n    number(region.luminance, 0, 1) && number(region.saturation, 0, 1) &&\n    number(region.warmth, -1, 1) && number(region.edgeStrength, 0, 1) &&\n    number(region.confidence, 0, 1)\n  );\n}\nfunction validReferenceImageEvidence(evidence: ReferenceImageEvidence) {\n  return (\n    !!evidence && text(evidence.assetId, 100) &&\n    Number.isInteger(evidence.sourceWidth) && number(evidence.sourceWidth, 2, 50000) &&\n    Number.isInteger(evidence.sourceHeight) && number(evidence.sourceHeight, 2, 50000) &&\n    Number.isInteger(evidence.sampledWidth) && number(evidence.sampledWidth, 2, 2000) &&\n    Number.isInteger(evidence.sampledHeight) && number(evidence.sampledHeight, 2, 2000) &&\n    Array.isArray(evidence.renderedPalette) && evidence.renderedPalette.length >= 1 &&\n    evidence.renderedPalette.length <= 8 && evidence.renderedPalette.every((entry) => color(entry)) &&\n    new Set(evidence.renderedPalette.map((entry) => entry.toLowerCase())).size === evidence.renderedPalette.length &&\n    (evidence.regions === undefined || (Array.isArray(evidence.regions) && evidence.regions.length <= 24 &&\n      new Set(evidence.regions.map((entry) => entry.id)).size === evidence.regions.length &&\n      evidence.regions.every(validReferenceColorRegion))) &&\n    number(evidence.averageLuminance, 0, 1) && number(evidence.warmFraction, 0, 1) &&\n    number(evidence.darkFraction, 0, 1) && number(evidence.highlightFraction, 0, 1) &&\n    number(evidence.averageSaturation, 0, 1) && number(evidence.verticalEdgeStrength, 0, 1) &&\n    number(evidence.horizontalEdgeStrength, 0, 1) &&\n    [\"day\", \"evening\", \"night\", \"unknown\"].includes(evidence.lightingMood) &&\n    number(evidence.confidence, 0, 1) && Number.isInteger(evidence.sampleCount) &&\n    number(evidence.sampleCount, 1, 1000000)\n  );\n}\n`,
    "domain evidence helper",
  );
  s = replaceRange(
    s,
    "  if (s.referenceImageEvidence !== undefined) {\n",
    "  if (s.materialOverrides !== undefined) {\n",
    `  if (s.referenceImageEvidence !== undefined && !validReferenceImageEvidence(s.referenceImageEvidence))\n    throw Error(\"Invalid reference image evidence.\");\n  if (s.referenceImageEvidenceSet !== undefined) {\n    if (!Array.isArray(s.referenceImageEvidenceSet) || s.referenceImageEvidenceSet.length < 1 ||\n      s.referenceImageEvidenceSet.length > 12 ||\n      new Set(s.referenceImageEvidenceSet.map((entry) => entry.assetId)).size !== s.referenceImageEvidenceSet.length ||\n      s.referenceImageEvidenceSet.some((entry) => !validReferenceImageEvidence(entry)))\n      throw Error(\"Invalid reference image evidence set.\");\n  }\n`,
    "domain evidence validation",
  );
  const assetAnchor = `    if (\n      s.referenceImageEvidence &&\n      !p.assets.includes(s.referenceImageEvidence.assetId)\n    )\n      throw Error(\"Reference image evidence asset is missing.\");\n`;
  s = replaceOnce(s, assetAnchor, assetAnchor + `    for (const evidence of s.referenceImageEvidenceSet ?? [])\n      if (!p.assets.includes(evidence.assetId))\n        throw Error(\"Reference image evidence-set asset is missing.\");\n`, "domain evidence assets");
  write(path, s);
}

// Cloud draft validator mirrors the browser schema.
{
  const path = "workers/studio-draft-validation.mjs";
  let s = read(path);
  const uniqueAnchor = `const uniqueIds = (items, max = 100) =>\n  Array.isArray(items) &&\n  items.length <= max &&\n  new Set(items.map((item) => item?.id)).size === items.length &&\n  items.every((item) => item && text(item.id, 100));\n`;
  s = replaceOnce(
    s,
    uniqueAnchor,
    uniqueAnchor + `\nfunction validReferenceRegion(region) {\n  return region && typeof region === \"object\" && !Array.isArray(region) &&\n    text(region.id, 100) && color(region.color) && number(region.coverage, 0.0001, 1) &&\n    number(region.centroidX, 0, 1) && number(region.centroidY, 0, 1) &&\n    number(region.minX, 0, 1) && number(region.minY, 0, 1) &&\n    number(region.maxX, 0, 1) && number(region.maxY, 0, 1) &&\n    region.minX <= region.centroidX && region.centroidX <= region.maxX &&\n    region.minY <= region.centroidY && region.centroidY <= region.maxY &&\n    number(region.luminance, 0, 1) && number(region.saturation, 0, 1) &&\n    number(region.warmth, -1, 1) && number(region.edgeStrength, 0, 1) &&\n    number(region.confidence, 0, 1);\n}\nfunction validReferenceEvidence(evidence, assetIds) {\n  return evidence && typeof evidence === \"object\" && !Array.isArray(evidence) && assetIds.has(evidence.assetId) &&\n    Number.isInteger(evidence.sourceWidth) && number(evidence.sourceWidth, 2, 50000) &&\n    Number.isInteger(evidence.sourceHeight) && number(evidence.sourceHeight, 2, 50000) &&\n    Number.isInteger(evidence.sampledWidth) && number(evidence.sampledWidth, 2, 2000) &&\n    Number.isInteger(evidence.sampledHeight) && number(evidence.sampledHeight, 2, 2000) &&\n    Array.isArray(evidence.renderedPalette) && evidence.renderedPalette.length >= 1 && evidence.renderedPalette.length <= 8 &&\n    evidence.renderedPalette.every(color) && new Set(evidence.renderedPalette.map((entry) => String(entry).toLowerCase())).size === evidence.renderedPalette.length &&\n    (evidence.regions === undefined || (Array.isArray(evidence.regions) && evidence.regions.length <= 24 &&\n      new Set(evidence.regions.map((entry) => entry?.id)).size === evidence.regions.length && evidence.regions.every(validReferenceRegion))) &&\n    number(evidence.averageLuminance, 0, 1) && number(evidence.warmFraction, 0, 1) &&\n    number(evidence.darkFraction, 0, 1) && number(evidence.highlightFraction, 0, 1) &&\n    number(evidence.averageSaturation, 0, 1) && number(evidence.verticalEdgeStrength, 0, 1) &&\n    number(evidence.horizontalEdgeStrength, 0, 1) && [\"day\", \"evening\", \"night\", \"unknown\"].includes(evidence.lightingMood) &&\n    number(evidence.confidence, 0, 1) && Number.isInteger(evidence.sampleCount) && number(evidence.sampleCount, 1, 1000000);\n}\n`,
    "worker evidence helper",
  );
  s = replaceRange(
    s,
    "  if (scene.referenceImageEvidence !== undefined) {\n",
    "  for (const floor of scene.floors)\n",
    `  if (scene.referenceImageEvidence !== undefined && !validReferenceEvidence(scene.referenceImageEvidence, assetIds))\n    throw Error(\"Invalid Studio reference image evidence.\");\n  if (scene.referenceImageEvidenceSet !== undefined) {\n    if (!Array.isArray(scene.referenceImageEvidenceSet) || scene.referenceImageEvidenceSet.length < 1 ||\n      scene.referenceImageEvidenceSet.length > 12 ||\n      new Set(scene.referenceImageEvidenceSet.map((entry) => entry?.assetId)).size !== scene.referenceImageEvidenceSet.length ||\n      scene.referenceImageEvidenceSet.some((entry) => !validReferenceEvidence(entry, assetIds)))\n      throw Error(\"Invalid Studio reference image evidence set.\");\n  }\n\n`,
    "worker evidence validation",
  );
  write(path, s);
}

// AutoBuild analyzes all visual references, then deterministically selects the primary.
{
  const path = "apps/admin/src/studio/autoBuildPipelineLegacy.ts";
  let s = read(path);
  const inspectorImport = `import {\n  inspectReferenceImage,\n  looksLikeGeneratedPlanReference,\n} from \"./referenceImageInspector\";\n`;
  s = replaceOnce(s, inspectorImport, inspectorImport + 'import { choosePrimaryVisualReference } from "./visualFacadeMatching";\n', "legacy primary import");
  s = replaceOnce(s, "    referenceImageEvidenceReady: boolean;\n    referencePaletteColors: number;\n", "    referenceImageEvidenceReady: boolean;\n    referenceImagesAnalyzed: number;\n    referenceImageRegions: number;\n    referencePaletteColors: number;\n", "legacy summary types");
  const multiBlock = `  const visualSourceIds = new Set(\n    analysis.sources\n      .filter((source) => source.role === \"visual\")\n      .map((source) => source.assetId),\n  );\n  const visualReferences = workingFiles\n    .filter(\n      (file) =>\n        visualSourceIds.has(file.id) &&\n        !looksLikeGeneratedPlanReference(file.name) &&\n        /\\.(?:png|jpe?g|webp|bmp)$/i.test(file.name),\n    )\n    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));\n  const analyzedVisualEvidence = [];\n  for (const visualReference of visualReferences) {\n    try {\n      const evidence = await inspectReferenceImage(visualReference);\n      if (evidence.confidence >= 0.45) analyzedVisualEvidence.push(evidence);\n      else issues.push(\`Reference image ${"${visualReference.name}"} decoded, but confidence ${"${Math.round(evidence.confidence * 100)}"}% is too low to retain as automatic appearance evidence.\`);\n    } catch (error) {\n      issues.push(error instanceof Error\n        ? \`Reference image analysis (${"${visualReference.name}"}): ${"${error.message}"}\`\n        : \`Reference image analysis (${"${visualReference.name}"}) could not complete.\`);\n    }\n  }\n  const primaryVisualEvidence = choosePrimaryVisualReference(analyzedVisualEvidence);\n  if (primaryVisualEvidence) {\n    next = { ...next, scene: { ...next.scene, referenceImageEvidence: primaryVisualEvidence, referenceImageEvidenceSet: analyzedVisualEvidence } };\n    if (analyzedVisualEvidence.length > 1)\n      issues.push(\`${"${analyzedVisualEvidence.length}"} visual reference images were analyzed. Rekixo selected a deterministic primary and preserved every reference for conflict-aware appearance review.\`);\n  }\n\n`;
  s = replaceRange(s, "  const visualSourceIds = new Set(\n", "  const draft = buildSmartSceneDraft(next, analysis);\n", multiBlock, "legacy multi-reference analysis");
  s = replaceOnce(s, `      referenceImageEvidenceReady: Boolean(\n        next.scene.referenceImageEvidence,\n      ),\n      referencePaletteColors:\n`, `      referenceImageEvidenceReady: Boolean(\n        next.scene.referenceImageEvidence,\n      ),\n      referenceImagesAnalyzed:\n        next.scene.referenceImageEvidenceSet?.length ?? (next.scene.referenceImageEvidence ? 1 : 0),\n      referenceImageRegions:\n        next.scene.referenceImageEvidenceSet?.reduce((sum, evidence) => sum + (evidence.regions?.length ?? 0), 0) ??\n        next.scene.referenceImageEvidence?.regions?.length ?? 0,\n      referencePaletteColors:\n`, "legacy summary values");
  const oldSummary = '  const referenceImage = summary.referenceImageEvidenceReady\n    ? ` · reference image: ${summary.referenceLightingMood || "unknown"} · ${summary.referencePaletteColors} rendered palette color${summary.referencePaletteColors === 1 ? "" : "s"} · visual structure evidence ready`\n    : "";\n';
  const newSummary = '  const referenceImage = summary.referenceImageEvidenceReady\n    ? ` · reference image: ${summary.referenceLightingMood || "unknown"} · ${summary.referenceImagesAnalyzed} visual reference${summary.referenceImagesAnalyzed === 1 ? "" : "s"} analyzed · ${summary.referenceImageRegions} color region${summary.referenceImageRegions === 1 ? "" : "s"} · ${summary.referencePaletteColors} rendered palette color${summary.referencePaletteColors === 1 ? "" : "s"}`\n    : "";\n';
  s = replaceOnce(s, oldSummary, newSummary, "legacy summary text");
  write(path, s);
}

// Rich top-level summary.
{
  const path = "apps/admin/src/studio/autoBuildPipeline.ts";
  let s = read(path);
  const oldLine = '    : ` · Phase 5 visual ${visual.status}${visual.appearance ? ` · appearance ${visual.appearance.status}` : ""}${visual.counts.suggestedMaterials ? ` · ${visual.counts.suggestedMaterials} source material suggestion${visual.counts.suggestedMaterials === 1 ? "" : "s"} for review` : ""}`;\n';
  const newLine = '    : ` · Phase 5 visual ${visual.status} · ${visual.counts.references} reference${visual.counts.references === 1 ? "" : "s"} · ${visual.counts.regions} region${visual.counts.regions === 1 ? "" : "s"}${visual.appearance ? ` · appearance ${visual.appearance.status}` : ""}${visual.counts.regionMatches ? ` · ${visual.counts.regionMatches} region material match${visual.counts.regionMatches === 1 ? "" : "es"}` : ""}${visual.counts.conflicts ? ` · ${visual.counts.conflicts} visual conflict${visual.counts.conflicts === 1 ? "" : "s"}` : ""}${visual.counts.suggestedMaterials ? ` · ${visual.counts.suggestedMaterials} source material suggestion${visual.counts.suggestedMaterials === 1 ? "" : "s"} for review` : ""}`;\n';
  s = replaceOnce(s, oldLine, newLine, "top visual summary");
  write(path, s);
}

// SceneCanvas returns an editor-clean current rendered appearance sample on request.
{
  const path = "apps/admin/src/studio/SceneCanvas.tsx";
  let s = read(path);
  s = replaceOnce(s, 'import { asset } from "./storage";\n', 'import { asset } from "./storage";\nimport { analyzeReferencePixels, type ReferencePixelAnalysis } from "./referenceImagePalette";\n', "canvas analysis import");
  s = replaceOnce(s, '  onModelMaterials?: (materials: ModelMaterialSummary[]) => void;\n  cameraOrientation?: "perspective" | "top";\n', '  onModelMaterials?: (materials: ModelMaterialSummary[]) => void;\n  visualSampleRequest?: number;\n  onVisualSample?: (sample: ReferencePixelAnalysis) => void;\n  onVisualSampleError?: (message: string) => void;\n  cameraOrientation?: "perspective" | "top";\n', "canvas sample props");
  const effectAnchor = `  useEffect(() => {\n    const r = api.current;\n    if (!r) return;\n    const alignment = props.scene.modelTransform ?? {\n`;
  const effect = `  useEffect(() => {\n    if (!props.visualSampleRequest || props.view !== \"building\") return;\n    const runtime = api.current;\n    if (!runtime || !runtime.model.children.length) {\n      props.onVisualSampleError?.(\"Load the building model before scoring the current view.\");\n      return;\n    }\n    const helper = runtime.transform.getHelper();\n    const visibility = [\n      [runtime.grid, runtime.grid.visible], [runtime.references, runtime.references.visible],\n      [helper, helper.visible], [runtime.roomDraft, runtime.roomDraft.visible],\n      [runtime.wallDraft, runtime.wallDraft.visible], [runtime.polygonDraft, runtime.polygonDraft.visible],\n      [runtime.polygonEdit, runtime.polygonEdit.visible], [runtime.multiSelection, runtime.multiSelection.visible],\n      ...(runtime.modelSelection ? [[runtime.modelSelection, runtime.modelSelection.visible]] : []),\n    ] as Array<[T.Object3D, boolean]>;\n    try {\n      for (const [object] of visibility) object.visible = false;\n      runtime.renderer.render(runtime.scene, runtime.camera);\n      const sourceCanvas = runtime.renderer.domElement;\n      const maxEdge = 640;\n      const scale = Math.min(1, maxEdge / Math.max(sourceCanvas.width, sourceCanvas.height));\n      const width = Math.max(2, Math.round(sourceCanvas.width * scale));\n      const height = Math.max(2, Math.round(sourceCanvas.height * scale));\n      const canvas = document.createElement(\"canvas\");\n      canvas.width = width; canvas.height = height;\n      const context = canvas.getContext(\"2d\", { willReadFrequently: true });\n      if (!context) throw Error(\"Rendered-view comparison canvas is unavailable.\");\n      context.drawImage(sourceCanvas, 0, 0, width, height);\n      const pixels = context.getImageData(0, 0, width, height);\n      props.onVisualSample?.(analyzeReferencePixels(pixels.data, width, height));\n    } catch (reason) {\n      props.onVisualSampleError?.(reason instanceof Error ? reason.message : \"Current rendered view could not be analyzed.\");\n    } finally {\n      for (const [object, visible] of visibility) object.visible = visible;\n      runtime.renderer.render(runtime.scene, runtime.camera);\n    }\n  }, [props.visualSampleRequest]);\n\n`;
  s = replaceOnce(s, effectAnchor, effect + effectAnchor, "canvas sample effect");
  write(path, s);
}

// Studio score request/result wiring.
{
  const path = "apps/admin/src/studio/Studio.tsx";
  let s = read(path);
  s = replaceOnce(s, 'import { applyTransformCommit } from "./sceneTransformApply";\n', 'import { applyTransformCommit } from "./sceneTransformApply";\nimport { compareVisualAppearance, type VisualDifferenceResult } from "./visualDifference";\n', "Studio score import");
  s = replaceOnce(s, '  const [sourceAudits, setSourceAudits] = useState<FbxSourceAudit[]>([]);\n  const [sourceAuditBusy, setSourceAuditBusy] = useState(false);\n', '  const [sourceAudits, setSourceAudits] = useState<FbxSourceAudit[]>([]);\n  const [sourceAuditBusy, setSourceAuditBusy] = useState(false);\n  const [visualSampleRequest, setVisualSampleRequest] = useState(0);\n  const [visualScoreBusy, setVisualScoreBusy] = useState(false);\n  const [visualDifference, setVisualDifference] = useState<VisualDifferenceResult>();\n', "Studio score state");
  s = replaceOnce(s, '    setModelMaterials([]);\n    setSelectedMaterial("");\n    setFurniturePlacementKind(undefined);\n', '    setModelMaterials([]);\n    setSelectedMaterial("");\n    setVisualSampleRequest(0);\n    setVisualScoreBusy(false);\n    setVisualDifference(undefined);\n    setFurniturePlacementKind(undefined);\n', "Studio score reset");
  s = replaceOnce(s, '  function edit(next: Project) {\n    if (!project) return;\n    setBackup(undefined);\n', '  function edit(next: Project) {\n    if (!project) return;\n    setBackup(undefined);\n    setVisualDifference(undefined);\n    setVisualScoreBusy(false);\n', "Studio invalidate score");
  const applyLook = '  function applyReferenceLook(action: VisualReviewAction) {\n    if (review || busy || sourceAuditBusy) return;\n    const next = applyVisualFacadeReview(p, sourceAudits, modelMaterials.map((material) => material.name), action);\n    if (next === p) return;\n    edit(next);\n    setMessage("Reviewed reference look applied. Use Undo to restore the previous look.");\n  }\n';
  s = replaceOnce(s, applyLook, applyLook + '  function requestVisualDifferenceScore() {\n    if (!p.scene.referenceImageEvidence) {\n      setError("Analyze a visual reference before scoring the current view.");\n      return;\n    }\n    setVisualDifference(undefined);\n    setVisualScoreBusy(true);\n    setVisualSampleRequest((value) => value + 1);\n  }\n', "Studio score request");
  s = replaceOnce(s, '            onModelNodes={setModelNodes}\n            onModelMaterials={setModelMaterials}\n          />\n', '            onModelNodes={setModelNodes}\n            onModelMaterials={setModelMaterials}\n            visualSampleRequest={visualSampleRequest}\n            onVisualSample={(sample) => {\n              const reference = p.scene.referenceImageEvidence;\n              setVisualScoreBusy(false);\n              if (!reference) return;\n              setVisualDifference(compareVisualAppearance(reference, sample, { viewpointAligned: true }));\n            }}\n            onVisualSampleError={(reason) => { setVisualScoreBusy(false); setError(reason); }}\n          />\n', "Studio canvas score wiring");
  s = replaceOnce(s, '              referenceName={files.find((file) => file.id === p.scene.referenceImageEvidence?.assetId)?.name}\n              disabled={Boolean(review) || busy || sourceAuditBusy}\n              onApply={applyReferenceLook}\n', '              referenceNames={Object.fromEntries(files.map((file) => [file.id, file.name]))}\n              disabled={Boolean(review) || busy || sourceAuditBusy}\n              onApply={applyReferenceLook}\n              onScoreRequest={requestVisualDifferenceScore}\n              visualDifference={visualDifference}\n              scoreBusy={visualScoreBusy}\n', "Studio review score props");
  write(path, s);
}

// Deterministic replay includes evidence-set and region geometry.
{
  const path = "apps/admin/src/studio/sceneReplayFingerprint.ts";
  let s = read(path);
  s = replaceOnce(s, "  Project,\n  Room,\n", "  Project,\n  ReferenceImageEvidence,\n  Room,\n", "fingerprint type");
  const helperAnchor = "async function sha256(value: string) {\n";
  const helper = `function referenceEvidenceSeed(evidence: ReferenceImageEvidence, assetRef: (id?: string) => string | undefined) {\n  return {\n    source: assetRef(evidence.assetId),\n    palette: [...evidence.renderedPalette].map((row) => row.toLowerCase()).sort(),\n    regions: [...(evidence.regions ?? [])].sort((left, right) => left.id.localeCompare(right.id)).map((region) => ({\n      id: region.id, color: region.color.toLowerCase(), coverage: round(region.coverage),\n      centroidX: round(region.centroidX), centroidY: round(region.centroidY),\n      minX: round(region.minX), minY: round(region.minY), maxX: round(region.maxX), maxY: round(region.maxY),\n      confidence: round(region.confidence),\n    })),\n    averageLuminance: round(evidence.averageLuminance), warmFraction: round(evidence.warmFraction),\n    darkFraction: round(evidence.darkFraction), highlightFraction: round(evidence.highlightFraction),\n    averageSaturation: round(evidence.averageSaturation),\n    verticalEdgeStrength: round(evidence.verticalEdgeStrength), horizontalEdgeStrength: round(evidence.horizontalEdgeStrength),\n    lightingMood: evidence.lightingMood, confidence: round(evidence.confidence),\n  };\n}\n\n`;
  s = replaceOnce(s, helperAnchor, helper + helperAnchor, "fingerprint helper");
  s = replaceRange(s, "    referenceImageEvidence: project.scene.referenceImageEvidence\n", "    floors: normalizedFloors,\n", `    referenceImageEvidence: project.scene.referenceImageEvidence\n      ? referenceEvidenceSeed(project.scene.referenceImageEvidence, assetRef)\n      : undefined,\n    referenceImageEvidenceSet: sortByCanonical(\n      project.scene.referenceImageEvidenceSet ?? [],\n      (evidence) => referenceEvidenceSeed(evidence, assetRef),\n    ).map((evidence) => referenceEvidenceSeed(evidence, assetRef)),\n`, "fingerprint evidence");
  write(path, s);
}

// Protected real-pack test requires region evidence from the actual visual file.
{
  const path = "e2e/golden-source-pack.spec.ts";
  let s = read(path);
  const anchor = '    await page.getByTestId("open-visual-editor").click();\n    await expect(page.getByLabel("3D editor tools")).toBeVisible({ timeout: 60_000 });\n';
  s = replaceOnce(s, anchor, anchor + '    const visualReview = page.getByTestId("visual-facade-review");\n    await expect(visualReview).toBeVisible({ timeout: 60_000 });\n    await visualReview.locator("summary").click();\n    await expect(page.getByTestId("visual-reference-summary")).toContainText(/[1-9]\\d* color region/i, { timeout: 60_000 });\n', "golden visual region proof");
  write(path, s);
}

// Roadmap: implementation complete; protected real pack remains the certification gate.
{
  const path = "docs/PERFECTION-ROADMAP-NEXT.md";
  let s = read(path);
  s = s.replace(
    "These are palette/name heuristics, not facade-region correspondence. Converted GLB and other models without an audit for the active asset have no automatic material application in this slice. Region correspondence, multiple-reference arbitration, visual-difference scoring and protected real-pack certification remain pending. The browser review test uses seeded analyzed evidence and verifies lighting apply/undo/redo/reload; it does not certify image recognition or the real six-file pack.",
    "Phase 5 implementation now includes deterministic spatial color-region evidence, conflict-aware multiple-reference arbitration, explicit reference-region-to-audited-material review, and an aligned-current-view appearance difference score. The score is presentation-only: camera, sky/background and occlusion affect it, and it never becomes dimensional or structural truth. Converted GLB and other models without an audit for the active asset still have no automatic material application. Protected real six-file certification remains the final Phase 5 gate.",
  );
  s = s.replace(
    "6. Add facade-region segmentation/correspondence, multiple-reference arbitration and visual-difference scoring without weakening metric-source authority.",
    "6. ✅ Add deterministic facade color-region correspondence, multiple-reference arbitration and aligned-view visual-difference scoring without weakening metric-source authority.",
  );
  s = s.replace(
    "7. Surface the visual plan in Studio as actionable review/apply controls, then include accepted runtime appearance/material overrides in deterministic replay.",
    "7. ✅ Surface the visual plan in Studio as actionable region review/apply controls; accepted runtime appearance/material overrides and retained reference evidence participate in deterministic replay.",
  );
  write(path, s);
}

console.log("Phase 5 completion wiring applied.");

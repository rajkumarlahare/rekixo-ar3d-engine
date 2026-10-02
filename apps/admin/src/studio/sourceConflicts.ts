import type { Asset } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import type { SourceFusionFact, SourceFusionItem } from "./sourceFusion";

export type SourceConflictKind =
  | "value-disagreement"
  | "ambiguous-source"
  | "missing-resource";

export interface SourceFusionConflict {
  id: string;
  kind: SourceConflictKind;
  severity: "review" | "warning";
  key: string;
  sourceAssetIds: string[];
  message: string;
}

function stableValue(value: SourceFusionFact["value"]) {
  if (Array.isArray(value))
    return JSON.stringify([...value].map(String).sort());
  return JSON.stringify(value);
}

function leaf(value: string) {
  return value.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
}

export function detectSourceFusionConflicts(
  files: readonly Asset[],
  items: readonly SourceFusionItem[],
  facts: readonly SourceFusionFact[],
  audits: readonly FbxSourceAudit[] = [],
): SourceFusionConflict[] {
  const conflicts: SourceFusionConflict[] = [];

  const modelItems = items.filter(
    (item) => item.kind === "authoring-model" || item.kind === "web-model",
  );
  const authoring = modelItems.filter((item) => item.kind === "authoring-model");
  if (authoring.length > 1)
    conflicts.push({
      id: "ambiguous-authoring-model",
      kind: "ambiguous-source",
      severity: "review",
      key: "model.authoring-source",
      sourceAssetIds: authoring.map((item) => item.assetId),
      message:
        "Multiple authoring-model candidates are attached. Select the intended source model once before automatic building.",
    });
  if (!authoring.length && modelItems.length > 1)
    conflicts.push({
      id: "ambiguous-web-model",
      kind: "ambiguous-source",
      severity: "review",
      key: "model.web-source",
      sourceAssetIds: modelItems.map((item) => item.assetId),
      message:
        "Multiple GLB model candidates are attached and no unique authoring model is known.",
    });

  // Provider-normalized facts use canonical.* keys. Once CAD/PDF/model processors
  // emit the same canonical fact, disagreements automatically enter this queue.
  const canonical = new Map<string, SourceFusionFact[]>();
  for (const fact of facts) {
    if (!fact.key.startsWith("canonical.")) continue;
    const rows = canonical.get(fact.key) ?? [];
    rows.push(fact);
    canonical.set(fact.key, rows);
  }
  for (const [key, rows] of canonical) {
    const distinctSources = new Set(rows.map((row) => row.sourceAssetId));
    const values = new Set(rows.map((row) => stableValue(row.value)));
    if (distinctSources.size < 2 || values.size < 2) continue;
    conflicts.push({
      id: `conflict:${key}`,
      kind: "value-disagreement",
      severity: "review",
      key,
      sourceAssetIds: [...distinctSources],
      message:
        `Sources disagree on ${key.replace(/^canonical\./, "").replaceAll(".", " ")}. Rekixo will not choose a value until it is reviewed.`,
    });
  }

  const attachedLeaves = new Set(files.map((file) => leaf(file.name)));
  for (const fact of facts) {
    if (fact.key !== "metadata.resource-refs" || !Array.isArray(fact.value))
      continue;
    const refs = fact.value
      .map(String)
      .filter((value) => /\.(?:fbx|glb|gltf|skp|skb)$/i.test(value));
    const missing = refs.filter((value) => !attachedLeaves.has(leaf(value)));
    if (!missing.length) continue;
    conflicts.push({
      id: `missing-model-ref:${fact.sourceAssetId}`,
      kind: "missing-resource",
      severity: "warning",
      key: "metadata.model-reference",
      sourceAssetIds: [fact.sourceAssetId],
      message:
        `Metadata references ${missing.length} model resource${missing.length === 1 ? "" : "s"} that are not attached by the same filename.`,
    });
  }

  for (const audit of audits) {
    const missing = audit.externalTextureFiles.filter(
      (value) => !attachedLeaves.has(leaf(value)),
    );
    if (!missing.length) continue;
    conflicts.push({
      id: `missing-textures:${audit.assetId}`,
      kind: "missing-resource",
      severity: "warning",
      key: "materials.external-textures",
      sourceAssetIds: [audit.assetId],
      message:
        `${missing.length} FBX texture reference${missing.length === 1 ? " is" : "s are"} still unresolved. Geometry can continue, but final materials need review/recovery.`,
    });
  }

  return conflicts;
}

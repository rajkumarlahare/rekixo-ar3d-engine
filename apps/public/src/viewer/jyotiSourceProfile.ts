import sourcePack from "../../../../project-profiles/jyoti-paradise/source-pack.json";

function sourceById(id: string) {
  const source = sourcePack.sources.find((item) => item.id === id);
  if (!source) throw Error(`Jyoti source profile is missing ${id}.`);
  return source;
}

function claimByKey(key: string) {
  return sourcePack.claims.find((item) => item.key === key);
}

function numberArrayClaim(key: string) {
  const claim = claimByKey(key);
  if (!claim || !Array.isArray(claim.value) || !claim.value.every(Number.isFinite))
    throw Error(`Jyoti source profile is missing numeric claim ${key}.`);
  return [...claim.value] as number[];
}

export const JYOTI_SOURCE_PACK_VERSION = sourcePack.version;
export const JYOTI_SOURCE_MODEL_SHA256 = sourceById("jyoti-source-fbx").sha256;
export const JYOTI_SOURCE_FLOOR_LEVELS_M = numberArrayClaim(
  "audit.architecturalFloorLevelsM",
);

export const JYOTI_SOURCE_PROVENANCE = {
  project: sourcePack.project,
  model: sourceById("jyoti-source-fbx"),
  drawing: sourceById("jyoti-source-dwg"),
  sketchupBackup: sourceById("jyoti-source-skb"),
  renderManifest: sourceById("jyoti-source-drs"),
  brochure: sourceById("jyoti-source-brochure"),
  visualReference: sourceById("jyoti-source-render"),
  brochurePlanScope: claimByKey("brochure.floorPlanTitle"),
  unitSeries: claimByKey("brochure.unitSeries"),
  unitAreasSqFt: claimByKey("brochure.unitAreasSqFt"),
  floorCountReview: claimByKey("review.floorCount"),
} as const;

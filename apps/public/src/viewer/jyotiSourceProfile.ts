import sourcePack from "../../../../project-profiles/jyoti-paradise/source-pack.json";

function sourceById(id: string) {
  const source = sourcePack.sources.find((item) => item.id === id);
  if (!source) throw Error(`Jyoti source profile is missing ${id}.`);
  return source;
}

function claimByKey(key: string) {
  return sourcePack.claims.find((item) => item.key === key);
}

export const JYOTI_SOURCE_PACK_VERSION = sourcePack.version;
export const JYOTI_SOURCE_MODEL_SHA256 = sourceById("jyoti-source-fbx").sha256;

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

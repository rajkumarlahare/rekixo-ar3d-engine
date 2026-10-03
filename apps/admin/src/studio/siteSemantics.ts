import type { LandscapeSiteElementKind } from "./domain";

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifySiteSemantic(
  value: string,
): LandscapeSiteElementKind | undefined {
  const text = normalized(value);
  if (!text) return undefined;

  if (
    /\b(?:outdoor light|street light|streetlight|lamp post|lamppost|bollard light|light pole)\b/.test(
      text,
    )
  )
    return "outdoor-light";
  if (
    /\b(?:parking|car park|carpark|parking bay|parking slot)\b/.test(text)
  )
    return "parking";
  if (/\b(?:driveway|drive way|road|carriageway)\b/.test(text))
    return "road";
  if (
    /\b(?:walkway|walk way|footpath|foot path|sidewalk|pathway|path|paver|paving)\b/.test(
      text,
    )
  )
    return "path";
  if (/\b(?:lawn|grass|turf)\b/.test(text)) return "lawn";
  if (
    /\b(?:garden|landscape area|landscaping|landscape)\b/.test(text)
  )
    return "garden";
  if (/\b(?:tree|palm|coconut tree|shade tree)\b/.test(text))
    return "tree";
  if (/\b(?:plant|shrub|bush|hedge|planter)\b/.test(text))
    return "plant";
  if (/\b(?:gate|entry gate|entrance gate)\b/.test(text)) return "gate";
  return undefined;
}

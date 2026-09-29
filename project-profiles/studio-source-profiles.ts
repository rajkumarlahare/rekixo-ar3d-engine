import jyotiSourcePack from "./jyoti-paradise/source-pack.json";
import jyotiInteriorScene from "./jyoti-paradise/interior-scene-v2.json";

const jyotiUnitById = new Map(
  jyotiInteriorScene.units.map((unit) => [
    unit.id,
    unit.id.includes("101")
      ? "101"
      : unit.id.includes("102")
        ? "102"
        : unit.id.includes("103")
          ? "103"
          : "Common",
  ]),
);

function sourceVectorClaim(key: string) {
  const claim = jyotiSourcePack.claims.find((candidate) => candidate.key === key);
  if (
    !claim ||
    !Array.isArray(claim.value) ||
    claim.value.length !== 3 ||
    !claim.value.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    throw Error(`Jyoti source profile is missing numeric claim ${key}.`);
  return claim.value as number[];
}

const jyotiBoundsMin = sourceVectorClaim("audit.bounds.min");
const jyotiBoundsMax = sourceVectorClaim("audit.bounds.max");
const jyotiSpanX = jyotiBoundsMax[0] - jyotiBoundsMin[0];
const jyotiSpanZ = jyotiBoundsMax[2] - jyotiBoundsMin[2];
const jyotiLayoutScale = Math.min(
  (jyotiSpanX * 1.25) / 18.6,
  (jyotiSpanZ * 1.35) / 20,
  1.15,
);
const jyotiLayoutCenterX = (jyotiBoundsMin[0] + jyotiBoundsMax[0]) / 2;
const jyotiLayoutCenterZ =
  (jyotiBoundsMin[2] + jyotiBoundsMax[2]) / 2 - jyotiSpanZ * 0.02;

// These centres mirror the existing reconstructed typical-floor presentation
// envelope against the verified FBX bounds. They are draft placement aids,
// never promoted to surveyed/verified architecture.
const jyotiRoomSheetTemplate = jyotiInteriorScene.rooms
  .filter((room) => room.boundary.kind === "rectangle")
  .map((room) => ({
    key: room.id,
    floor: "Typical residential floor",
    unit: jyotiUnitById.get(room.unitId) ?? room.unitId,
    name: room.name
      .replace(/\s+\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*$/i, "")
      .replace(/\s+\d+(?:\.\d+)?\s*$/i, "")
      .trim(),
    width: room.boundary.size[0],
    depth: room.boundary.size[1],
    height: room.ceilingHeightM,
    suggestedX: Number(
      (jyotiLayoutCenterX + room.boundary.center[0] * jyotiLayoutScale).toFixed(
        4,
      ),
    ),
    suggestedZ: Number(
      (jyotiLayoutCenterZ + room.boundary.center[1] * jyotiLayoutScale).toFixed(
        4,
      ),
    ),
    sourcePackSourceId: room.evidence.sourcePackSourceId,
    sourceNote: room.evidence.sourceNote,
  }));

export const studioSourceProfiles = [
  {
    id: "jyoti-paradise",
    name: "Jyoti Paradise",
    slug: "jyoti-paradise",
    location: "Hingna, Nagpur",
    minMatches: 2,
    requireAnyOf: ["primaryModel", "floorPlan"],
    roomSheetTemplate: jyotiRoomSheetTemplate,
    alignment: {
      slotKey: "floorPlan",
      page: 2,
      crop: {
        x: 0.5,
        y: 0.12,
        width: 0.48,
        height: 0.84,
      },
      label: "typical-floor-plan",
    },
    sources: [
      {
        key: "primaryModel",
        label: "Primary 3D model",
        sourceId: "jyoti-source-fbx",
      },
      {
        key: "floorPlan",
        label: "Brochure / floor plan",
        sourceId: "jyoti-source-brochure",
      },
      {
        key: "cad",
        label: "CAD dimensional source",
        sourceId: "jyoti-source-dwg",
      },
      {
        key: "visualReference",
        label: "Exterior realism reference",
        sourceId: "jyoti-source-render",
      },
      {
        key: "backupModel",
        label: "SketchUp backup",
        sourceId: "jyoti-source-skb",
      },
      {
        key: "renderMetadata",
        label: "D5 render metadata",
        sourceId: "jyoti-source-drs",
      },
    ].map((slot) => {
      const source = jyotiSourcePack.sources.find(
        (candidate) => candidate.id === slot.sourceId,
      );
      if (!source)
        throw Error(`Jyoti source profile is missing ${slot.sourceId}.`);
      return {
        ...slot,
        sha256: source.sha256,
        byteSize: source.byteSize,
      };
    }),
  },
] as const;

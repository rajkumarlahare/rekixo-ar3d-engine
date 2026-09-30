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

function sourceNumberArrayClaim(key: string) {
  const claim = jyotiSourcePack.claims.find((candidate) => candidate.key === key);
  if (
    !claim ||
    !Array.isArray(claim.value) ||
    !claim.value.length ||
    !claim.value.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    throw Error(`Jyoti source profile is missing numeric-array claim ${key}.`);
  return claim.value as number[];
}

const jyotiBoundsMin = sourceVectorClaim("audit.bounds.min");
const jyotiBoundsMax = sourceVectorClaim("audit.bounds.max");
const jyotiArchitecturalLevels = sourceNumberArrayClaim(
  "audit.architecturalFloorLevelsM",
);
const jyotiFloorSkeleton = jyotiArchitecturalLevels.map((elevation, index) => {
  const last = index === jyotiArchitecturalLevels.length - 1;
  return {
    key: index === 0 ? "ground" : last ? "roof" : `floor-${index}`,
    name: index === 0 ? "Ground" : last ? "Roof" : `Floor ${index}`,
    sourceElevation: elevation,
    kind:
      index === 0
        ? ("ground" as const)
        : last
          ? ("roof" as const)
          : ("residential" as const),
    sourcePackSourceId: "jyoti-source-fbx",
    sourceClaimIds: ["fbx-floor-levels"],
    note:
      "Model-derived FBX level band. Useful for authoring alignment; not an independent as-built survey.",
  };
});
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

const jyotiExpectedRoomCount = (unit: string) =>
  jyotiRoomSheetTemplate.filter((room) => room.unit === unit).length;

const jyotiRepeatPlan = {
  id: "jyoti-brochure-unit-series",
  label: "Jyoti brochure unit-series preview",
  sourceFloorKey: "floor-1",
  note:
    "Brochure page 2 states 101 to 501, 102 to 502 and 103 to 403, while the same brochure labels the drawing 1st to 3rd FLOOR PLAN. Rekixo therefore treats generated upper-floor layouts as unverified authoring copies, not a certified legal floor schedule.",
  series: [
    {
      sourceUnit: "101",
      expectedRoomCount: jyotiExpectedRoomCount("101"),
      targets: [
        { floorKey: "floor-2", targetUnit: "201" },
        { floorKey: "floor-3", targetUnit: "301" },
        { floorKey: "floor-4", targetUnit: "401" },
        { floorKey: "floor-5", targetUnit: "501" },
      ],
    },
    {
      sourceUnit: "102",
      expectedRoomCount: jyotiExpectedRoomCount("102"),
      targets: [
        { floorKey: "floor-2", targetUnit: "202" },
        { floorKey: "floor-3", targetUnit: "302" },
        { floorKey: "floor-4", targetUnit: "402" },
        { floorKey: "floor-5", targetUnit: "502" },
      ],
    },
    {
      sourceUnit: "103",
      expectedRoomCount: jyotiExpectedRoomCount("103"),
      targets: [
        { floorKey: "floor-2", targetUnit: "203" },
        { floorKey: "floor-3", targetUnit: "303" },
        { floorKey: "floor-4", targetUnit: "403" },
      ],
    },
  ],
};

export const studioSourceProfiles = [
  {
    id: "jyoti-paradise",
    name: "Jyoti Paradise",
    slug: "jyoti-paradise",
    location: "Hingna, Nagpur",
    minMatches: 2,
    requireAnyOf: ["primaryModel", "floorPlan"],
    floorSkeleton: jyotiFloorSkeleton,
    repeatPlan: jyotiRepeatPlan,
    publishModel: {
      name: "jyoti-source-preserved.glb",
      mimeType: "model/gltf-binary",
      byteSize: 25582856,
      sha256:
        "45316366101b3790da9699949bef7e4507a800da2321c3de874b55e5fa3e64d8",
      url:
        "/3Dprojects/published/jyoti-paradise/45316366101b3790da9699949bef7e4507a800da2321c3de874b55e5fa3e64d8.glb",
    },
    roomSheetTemplate: jyotiRoomSheetTemplate,
    interiorAutomation: { enabled: true },
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

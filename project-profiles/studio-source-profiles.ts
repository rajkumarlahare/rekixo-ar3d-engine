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

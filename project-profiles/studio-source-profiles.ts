import jyotiSourcePack from "./jyoti-paradise/source-pack.json";

export const studioSourceProfiles = [
  {
    id: "jyoti-paradise",
    name: "Jyoti Paradise",
    slug: "jyoti-paradise",
    location: "Hingna, Nagpur",
    minMatches: 2,
    requireAnyOf: ["primaryModel", "floorPlan"],
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

import jyotiSourcePack from "../../../../project-profiles/jyoti-paradise/source-pack.json";
import type { Asset, Project } from "./domain";

export type QuickSourceSlotKey =
  | "primaryModel"
  | "floorPlan"
  | "cad"
  | "visualReference"
  | "backupModel"
  | "renderMetadata";

export interface QuickSourceSlot {
  key: QuickSourceSlotKey;
  label: string;
  sourceId: string;
  asset?: Asset;
  exact: boolean;
}

export interface QuickSourceSetup {
  profile?: "jyoti-paradise";
  name?: string;
  slug?: string;
  location?: string;
  slots: QuickSourceSlot[];
  matchedCount: number;
  requiredCount: number;
  complete: boolean;
  primaryModelId?: string;
}

const SLOT_DEFINITIONS: Array<{
  key: QuickSourceSlotKey;
  label: string;
  sourceId: string;
}> = [
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
];

const sourceById = new Map(
  jyotiSourcePack.sources.map((source) => [source.id, source] as const),
);

function assetForSource(files: Asset[], sourceId: string) {
  const source = sourceById.get(sourceId);
  if (!source) return undefined;
  return files.find(
    (asset) =>
      asset.hash.toLowerCase() === String(source.sha256).toLowerCase() &&
      asset.size === Number(source.byteSize),
  );
}

export function detectQuickSourceSetup(files: Asset[]): QuickSourceSetup {
  const slots = SLOT_DEFINITIONS.map(({ key, label, sourceId }) => {
    const asset = assetForSource(files, sourceId);
    return { key, label, sourceId, asset, exact: Boolean(asset) };
  });
  const matchedCount = slots.filter((slot) => slot.exact).length;
  const primaryModel = slots.find((slot) => slot.key === "primaryModel")?.asset;
  const floorPlan = slots.find((slot) => slot.key === "floorPlan")?.asset;
  const recognizable =
    matchedCount >= 2 && Boolean(primaryModel || floorPlan);

  if (!recognizable)
    return {
      slots,
      matchedCount,
      requiredCount: slots.length,
      complete: false,
    };

  return {
    profile: "jyoti-paradise",
    name: "Jyoti Paradise",
    slug: "jyoti-paradise",
    location: "Hingna, Nagpur",
    slots,
    matchedCount,
    requiredCount: slots.length,
    complete: matchedCount === slots.length,
    primaryModelId: primaryModel?.id,
  };
}

export function applyQuickSourceSetup(
  project: Project,
  setup: QuickSourceSetup,
): Project {
  if (setup.profile !== "jyoti-paradise")
    throw Error("No recognized project source pack is ready for auto setup.");

  const nextModelId = setup.primaryModelId ?? project.scene.modelId;
  const modelChanged =
    Boolean(nextModelId) && nextModelId !== project.scene.modelId;

  return {
    ...project,
    name: setup.name ?? project.name,
    slug: setup.slug ?? project.slug,
    location: project.location?.trim()
      ? project.location
      : setup.location ?? "",
    scene: {
      ...project.scene,
      ...(nextModelId ? { modelId: nextModelId } : {}),
      ...(modelChanged
        ? {
            modelNodeTags: [],
            rooms: project.scene.rooms.map((room) => ({
              ...room,
              mesh: undefined,
            })),
          }
        : {}),
    },
  };
}

import type { Asset, Project } from "./domain";
import {
  applyFloorSkeleton,
  type FloorSkeletonLevel,
} from "./floorSkeleton";
import type { RoomSheetTemplateRow } from "./roomSheet";

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

export interface QuickAlignmentPreset {
  slotKey: QuickSourceSlotKey;
  page?: number;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  label?: string;
}

export interface QuickSourceSetup {
  profile?: string;
  name?: string;
  slug?: string;
  location?: string;
  alignment?: QuickAlignmentPreset;
  floorSkeleton?: readonly FloorSkeletonLevel[];
  roomSheetTemplate?: readonly RoomSheetTemplateRow[];
  slots: QuickSourceSlot[];
  matchedCount: number;
  requiredCount: number;
  complete: boolean;
  primaryModelId?: string;
}

interface SourceProfileDefinition {
  id: string;
  name: string;
  slug: string;
  location?: string;
  minMatches?: number;
  requireAnyOf?: readonly QuickSourceSlotKey[];
  alignment?: QuickAlignmentPreset;
  floorSkeleton?: readonly FloorSkeletonLevel[];
  roomSheetTemplate?: readonly RoomSheetTemplateRow[];
  sources: ReadonlyArray<{
    key: QuickSourceSlotKey;
    label: string;
    sourceId: string;
    sha256: string;
    byteSize: number;
  }>;
}

export function emptyQuickSourceSetup(): QuickSourceSetup {
  return {
    slots: [],
    matchedCount: 0,
    requiredCount: 0,
    complete: false,
  };
}

async function sourceProfiles(): Promise<readonly SourceProfileDefinition[]> {
  const module = await import("../../../../project-profiles/studio-source-profiles");
  return module.studioSourceProfiles as readonly SourceProfileDefinition[];
}

function detectProfile(
  files: Asset[],
  profile: SourceProfileDefinition,
): QuickSourceSetup {
  const slots = profile.sources.map((source) => {
    const asset = files.find(
      (candidate) =>
        candidate.hash.toLowerCase() === source.sha256.toLowerCase() &&
        candidate.size === source.byteSize,
    );
    return {
      key: source.key,
      label: source.label,
      sourceId: source.sourceId,
      asset,
      exact: Boolean(asset),
    };
  });
  const matchedCount = slots.filter((slot) => slot.exact).length;
  const requiredKeys = profile.requireAnyOf ?? [];
  const hasRequiredIdentity =
    requiredKeys.length === 0 ||
    requiredKeys.some((key) =>
      slots.some((slot) => slot.key === key && slot.exact),
    );
  const recognizable =
    matchedCount >= (profile.minMatches ?? 2) && hasRequiredIdentity;
  if (!recognizable)
    return {
      slots,
      matchedCount,
      requiredCount: slots.length,
      complete: false,
    };

  return {
    profile: profile.id,
    name: profile.name,
    slug: profile.slug,
    location: profile.location,
    alignment: profile.alignment,
    floorSkeleton: profile.floorSkeleton,
    roomSheetTemplate: profile.roomSheetTemplate,
    slots,
    matchedCount,
    requiredCount: slots.length,
    complete: matchedCount === slots.length,
    primaryModelId: slots.find((slot) => slot.key === "primaryModel")?.asset?.id,
  };
}

export async function detectQuickSourceSetup(
  files: Asset[],
): Promise<QuickSourceSetup> {
  const profiles = await sourceProfiles();
  let best = emptyQuickSourceSetup();
  for (const profile of profiles) {
    const candidate = detectProfile(files, profile);
    if (candidate.profile && candidate.matchedCount > best.matchedCount)
      best = candidate;
  }
  return best;
}

export function applyQuickSourceSetup(
  project: Project,
  setup: QuickSourceSetup,
): Project {
  if (!setup.profile)
    throw Error("No recognized project source pack is ready for auto setup.");

  const nextModelId = setup.primaryModelId ?? project.scene.modelId;
  const modelChanged =
    Boolean(nextModelId) && nextModelId !== project.scene.modelId;
  const floorResult = applyFloorSkeleton(
    project.scene,
    setup.profile,
    setup.floorSkeleton,
  );

  return {
    ...project,
    name: setup.name ?? project.name,
    slug: setup.slug ?? project.slug,
    location: project.location?.trim()
      ? project.location
      : setup.location ?? "",
    scene: {
      ...project.scene,
      floors: floorResult.floors,
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

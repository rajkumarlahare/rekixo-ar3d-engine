import { id, type Asset, type Project } from "./domain";
import {
  applyFloorSkeleton,
  type FloorSkeletonLevel,
} from "./floorSkeleton";
import type { RoomSheetTemplateRow } from "./roomSheet";
import type { BatchRepeatPlan } from "./unitRepeat";

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

export interface TrustedPublishModel {
  name: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  url: string;
}

export interface ProfileInteriorAutomation {
  enabled: boolean;
}

export interface QuickSourceSetup {
  profile?: string;
  name?: string;
  slug?: string;
  location?: string;
  alignment?: QuickAlignmentPreset;
  floorSkeleton?: readonly FloorSkeletonLevel[];
  repeatPlan?: BatchRepeatPlan;
  publishModel?: TrustedPublishModel;
  publishModelId?: string;
  roomSheetTemplate?: readonly RoomSheetTemplateRow[];
  interiorAutomation?: ProfileInteriorAutomation;
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
  repeatPlan?: BatchRepeatPlan;
  publishModel?: TrustedPublishModel;
  roomSheetTemplate?: readonly RoomSheetTemplateRow[];
  interiorAutomation?: ProfileInteriorAutomation;
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
  const publishModelId = profile.publishModel
    ? files.find(
        (candidate) =>
          candidate.hash.toLowerCase() ===
            profile.publishModel!.sha256.toLowerCase() &&
          candidate.size === profile.publishModel!.byteSize,
      )?.id
    : undefined;
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
    repeatPlan: profile.repeatPlan,
    publishModel: profile.publishModel,
    publishModelId,
    roomSheetTemplate: profile.roomSheetTemplate,
    interiorAutomation: profile.interiorAutomation,
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

async function sha256Hex(blob: Blob) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
  );
  return Array.from(digest, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function prepareQuickPublishModel(
  setup: QuickSourceSetup,
  files: Asset[],
  projectId: string,
): Promise<{ setup: QuickSourceSetup; asset?: Asset }> {
  const descriptor = setup.publishModel;
  if (!descriptor) return { setup };

  const existing = files.find(
    (candidate) =>
      candidate.hash.toLowerCase() === descriptor.sha256.toLowerCase() &&
      candidate.size === descriptor.byteSize,
  );
  if (existing)
    return {
      setup: { ...setup, publishModelId: existing.id },
    };

  if (
    !/^\/3Dprojects\/published\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-f0-9]{64}\.glb$/.test(
      descriptor.url,
    )
  )
    throw Error("Trusted publish-model URL is invalid.");

  const response = await fetch(descriptor.url, { cache: "no-store" });
  if (!response.ok)
    throw Error(
      `Web publish model could not be prepared (${response.status}).`,
    );
  const blob = await response.blob();
  if (blob.size !== descriptor.byteSize)
    throw Error("Web publish model size verification failed.");
  const hash = await sha256Hex(blob);
  if (hash !== descriptor.sha256.toLowerCase())
    throw Error("Web publish model checksum verification failed.");

  const asset: Asset = {
    id: id(),
    projectId,
    name: descriptor.name,
    type: descriptor.mimeType || "model/gltf-binary",
    size: blob.size,
    hash,
    blob,
  };
  return {
    setup: { ...setup, publishModelId: asset.id },
    asset,
  };
}

export function applyQuickSourceSetup(
  project: Project,
  setup: QuickSourceSetup,
): Project {
  if (!setup.profile)
    throw Error("No recognized project source pack is ready for auto setup.");

  const nextModelId = setup.primaryModelId ?? project.scene.modelId;
  const nextPublishModelId =
    setup.publishModelId ?? project.scene.publishModelId;
  const modelChanged =
    Boolean(nextModelId) && nextModelId !== project.scene.modelId;
  const floorResult = applyFloorSkeleton(
    project.scene,
    setup.profile,
    setup.floorSkeleton,
  );

  return {
    ...project,
    assets:
      setup.publishModelId && !project.assets.includes(setup.publishModelId)
        ? [...project.assets, setup.publishModelId]
        : project.assets,
    name: setup.name ?? project.name,
    slug: setup.slug ?? project.slug,
    location: project.location?.trim()
      ? project.location
      : setup.location ?? "",
    scene: {
      ...project.scene,
      floors: floorResult.floors,
      ...(nextModelId ? { modelId: nextModelId } : {}),
      ...(nextPublishModelId
        ? { publishModelId: nextPublishModelId }
        : {}),
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

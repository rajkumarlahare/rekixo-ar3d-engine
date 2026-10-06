import type { BuildingPresentationManifestV1 } from "./building-presentation-manifest-v1";

export * from "./runtime-validation";
export * from "./release-manifest-v1";
export * from "./building-presentation-manifest-v1";
export * from "./scene-source-evidence";
export * from "./source-pack-v1";
export * from "./source-pack-v2";
export * from "./canonical-model-manifest-v1";
export * from "./node-catalog-v1";
export * from "./scene-manifest-v2";
export * from "./geo-presentation-manifest-v1";
export const ADMIN_BASE_PATH = "/3Dprojects" as const;
export const PUBLIC_BASE_PATH = "/3Dprojects" as const;
export const PLATFORM_ENGINE_CONTRACT_VERSION = 1 as const;

export type Project3DStatus = "draft" | "published" | "archived";

/**
 * Customer-facing deliverables owned by the Engine.
 *
 * Building is the canonical/default deliverable. Geo is an optional add-on
 * that references an immutable Building release instead of copying the
 * Building project or its source assets.
 */
export type Experience3DType = "building" | "geo";

export type Experience3DLifecycle = "active" | "archived";

export interface Experience3DIdentity {
  projectId: string;
  type: Experience3DType;
  slug: string;
}

export interface EngineExperienceSummary {
  id: string;
  projectId: string;
  type: Experience3DType;
  lifecycle: Experience3DLifecycle;
  sourceBuildingReleaseId?: string;
  sourceBuildingReleaseVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminExperiencesResponse {
  experiences: EngineExperienceSummary[];
}

export type Scene3DType =
  | "project-navigation"
  | "section"
  | "wing-distance"
  | "balcony"
  | "typical-floor"
  | "amenity";

export interface Project3D {
  id: string;
  slug: string;
  name: string;
  location?: string;
  status: Project3DStatus;
  coverAssetKey?: string;
  defaultSceneId?: string;
}

export interface EngineProjectSummary extends Project3D {
  modelCount?: number;
  sceneCount?: number;
  enabledSceneCount?: number;
}

export interface AdminProjectsResponse {
  projects: EngineProjectSummary[];
}

export interface CameraPreset3D {
  id: string;
  projectId: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface Model3D {
  id: string;
  projectId: string;
  name: string;
  version: number;
  byteSize?: number;
  sourceFilename?: string;
  mimeType: string;
  available: boolean;
  url?: string;
}

export interface Scene3D {
  id: string;
  projectId: string;
  name: string;
  type: Scene3DType;
  modelId?: string;
  cameraPresetId?: string;
  sortOrder: number;
  enabled: boolean;
  settings?: Record<string, unknown>;
}

export type PublicWalkthroughPoint = [number, number];

export interface PublicWalkthroughRoom {
  id: string;
  floorId: string;
  name: string;
  unit: string;
  elevation: number;
  height: number;
  boundary: PublicWalkthroughPoint[];
}

export interface PublicWalkthroughDoor {
  id: string;
  floorId: string;
  roomIds: [string, string];
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  rotationY: number;
}

export type PublicSiteElementKind =
  | "garden"
  | "lawn"
  | "path"
  | "road"
  | "parking"
  | "tree"
  | "plant"
  | "gate"
  | "outdoor-light"
  | "column"
  | "beam"
  | "slab"
  | "roof"
  | "duct"
  | "balcony"
  | "boundary"
  | "stair"
  | "lift";

export interface PublicSiteElement {
  id: string;
  kind: PublicSiteElementKind;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  color: string;
  /** Structural primitives may preserve a source-backed circular envelope. */
  shape?: "box" | "cylinder";
}

export interface PublicWalkthroughGraph {
  version: 1;
  metresPerUnit: number;
  rooms: PublicWalkthroughRoom[];
  doors: PublicWalkthroughDoor[];
}

export interface Public3DExperience {
  project: Project3D;
  scene?: Scene3D;
  scenes?: Scene3D[];
  camera?: CameraPreset3D;
  model?: Model3D;
  mediaBaseUrl?: string;
  walkthrough?: PublicWalkthroughGraph;
  siteElements?: PublicSiteElement[];
  /** Immutable, release-bound automatic presentation instructions. */
  buildingPresentation?: BuildingPresentationManifestV1;
}

export interface Admin3DProjectStatus {
  project: Project3D;
  scenes: Scene3D[];
  models: Model3D[];
  activeModel?: Model3D;
  modelPage?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  storage: {
    bucket: string;
    activeModelObjectAvailable: boolean;
  };
}

export interface PlatformEngineProjectContract {
  contractVersion: typeof PLATFORM_ENGINE_CONTRACT_VERSION;
  project: Project3D;
  enabledSceneCount: number;
  activeModelAvailable: boolean;
  /**
   * Additive V1 fields. New Studio/cloud projects can publish directly from an
   * immutable release without creating a legacy models_3d row. Older consumers
   * may ignore these fields and older projects remain valid without them.
   */
  model?: Model3D;
  geoModel?: Model3D & {
    variant: "geo-optimized";
    sourceModelId: string;
    sourceSha256?: string;
    sha256?: string;
  };
  release?: {
    id: string;
    version: number;
    manifestSha256?: string;
    createdAt?: string;
  };
}

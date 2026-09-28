export * from "./scene-manifest-v2";
export const ADMIN_BASE_PATH = "/3Dprojects" as const;
export const PUBLIC_BASE_PATH = "/3Dprojects" as const;
export const PLATFORM_ENGINE_CONTRACT_VERSION = 1 as const;

export type Project3DStatus = "draft" | "published" | "archived";

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

export interface Public3DExperience {
  project: Project3D;
  scene?: Scene3D;
  scenes?: Scene3D[];
  camera?: CameraPreset3D;
  model?: Model3D;
  mediaBaseUrl?: string;
}

export interface Admin3DProjectStatus {
  project: Project3D;
  scenes: Scene3D[];
  models: Model3D[];
  activeModel?: Model3D;
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
}

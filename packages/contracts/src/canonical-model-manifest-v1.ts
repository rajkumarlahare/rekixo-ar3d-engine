export const CANONICAL_MODEL_MANIFEST_FORMAT = "rekixo-canonical-model" as const;
export const CANONICAL_MODEL_MANIFEST_VERSION = 1 as const;

export interface CanonicalModelManifestV1 {
  format: typeof CANONICAL_MODEL_MANIFEST_FORMAT;
  version: typeof CANONICAL_MODEL_MANIFEST_VERSION;
  project: {
    id: string;
    slug: string;
  };
  sourcePack: {
    id: string;
    version: number;
    manifestSha256: string;
  };
  processor: {
    version: string;
    execution: "cloudflare-worker-glb-v1" | string;
  };
  geometryAuthority: {
    sourceFileId: string;
    filename: string;
    mediaType: string;
    byteSize: number;
    sha256: string;
  };
  model: {
    r2Key: string;
    mimeType: "model/gltf-binary";
    byteSize: number;
    sha256: string;
    gltfVersion: string;
    sourceGenerator: string | null;
    coordinateSystem: {
      units: "metre";
      upAxis: "+Y";
      handedness: "right";
    };
    statistics: {
      sceneCount: number;
      nodeCount: number;
      meshCount: number;
      materialCount: number;
      textureCount: number;
      imageCount: number;
      animationCount: number;
    };
    requiredExtensions: string[];
    validation: {
      glbHeader: "validated";
      selfContained: true;
      sourceIdentity: "verified";
      geometryTransform: "preserved";
    };
  };
  processedAt: string;
}

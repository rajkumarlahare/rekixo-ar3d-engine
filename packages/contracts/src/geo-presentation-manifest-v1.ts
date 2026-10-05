export const GEO_PRESENTATION_MANIFEST_FORMAT =
  "rekixo.geo-presentation" as const;
export const GEO_PRESENTATION_MANIFEST_VERSION = 1 as const;
export const GEO_COORDINATE_REFERENCE_SYSTEM = "WGS84" as const;
export const GEO_LOCAL_FRAME = "ENU" as const;
export const GEO_MODEL_UNITS = "m" as const;

/**
 * The Building model is a rigid object in Geo. Master-plan calibration may use
 * a 2D transform, but it must never warp or rebuild Building geometry.
 */
export type GeoHeightMode =
  | "ground-clamped"
  | "ground-relative"
  | "absolute";

export type GeoAnchorKind =
  | "entrance"
  | "main-gate"
  | "site-center"
  | "south-west-corner"
  | "custom";

export type GeoCalibrationStatus = "unverified" | "verified" | "failed";

export interface GeoLocalPositionMetresV1 {
  x: number;
  y: number;
  z: number;
}

export interface GeoWgs84CoordinateV1 {
  longitude: number;
  latitude: number;
  altitudeM?: number;
}

export interface GeoModelAnchorV1 {
  id: string;
  name: string;
  kind: GeoAnchorKind;
  localPositionM: GeoLocalPositionMetresV1;
}

/**
 * WGS84 is the durable geographic truth. Fine alignment is stored in a local
 * East/North/Up frame so operator adjustments remain metric and map-provider
 * independent.
 */
export interface GeoPlacementV1 {
  coordinateReferenceSystem: typeof GEO_COORDINATE_REFERENCE_SYSTEM;
  localFrame: typeof GEO_LOCAL_FRAME;
  units: typeof GEO_MODEL_UNITS;
  anchor: GeoWgs84CoordinateV1;
  heightMode: GeoHeightMode;
  eastOffsetM: number;
  northOffsetM: number;
  verticalOffsetM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** Uniform correction only. Canonical models should normally publish at 1. */
  scale: number;
}

export interface GeoControlPointV1 {
  id: string;
  /** Normalized source-image coordinates in the inclusive 0..1 range. */
  sourceUv: [number, number];
  world: GeoWgs84CoordinateV1;
}

export interface GeoCalibrationReportV1 {
  algorithm: "homography-v1";
  pointCount: number;
  rmsErrorM: number;
  maxErrorM: number;
  worstControlPointId?: string;
  status: GeoCalibrationStatus;
}

export interface GeoMasterplanOverlayV1 {
  assetKey: string;
  sourceSha256?: string;
  opacity: number;
  controlPoints: GeoControlPointV1[];
  calibration: GeoCalibrationReportV1;
}

export interface GeoSiteBoundaryV1 {
  /** Ordered WGS84 ring. First point need not be repeated at the end. */
  points: GeoWgs84CoordinateV1[];
}

export interface GeoCameraPresetV1 {
  id: string;
  name: string;
  kind: "aerial" | "site" | "building" | "approach" | "custom";
  longitude: number;
  latitude: number;
  altitudeM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface GeoDisplayConfigV1 {
  showMasterplanByDefault: boolean;
  showBoundaryByDefault: boolean;
  showRoadsByDefault: boolean;
  showLabelsByDefault: boolean;
}

export interface GeoPresentationManifestV1 {
  format: typeof GEO_PRESENTATION_MANIFEST_FORMAT;
  version: typeof GEO_PRESENTATION_MANIFEST_VERSION;
  release: {
    id: string;
    experienceId: string;
    projectId: string;
    projectSlug: string;
    version: number;
    sourceDraftRevision: number;
    createdAt: string;
  };
  project: {
    id: string;
    slug: string;
    name: string;
    location?: string;
  };
  sourceBuilding: {
    releaseId: string;
    version: number;
    manifestSha256: string;
  };
  model: {
    id: string;
    url: string;
    mimeType: "model/gltf-binary";
    sha256?: string;
    variant: "geo-optimized" | "building";
  };
  modelAnchor: GeoModelAnchorV1;
  placement: GeoPlacementV1;
  siteBoundary?: GeoSiteBoundaryV1;
  masterplanOverlay?: GeoMasterplanOverlayV1;
  cameras?: GeoCameraPresetV1[];
  display?: GeoDisplayConfigV1;
}

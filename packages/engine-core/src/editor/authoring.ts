export type AuthoringId = string;
export type AuthoringPoint2 = readonly [number, number];

export interface SourceProvenance {
  sourceAssetId?: string;
  sourceClaimIds?: readonly string[];
  confidence?: number;
  reviewed?: boolean;
}

export interface AuthoringWall extends SourceProvenance {
  id: AuthoringId;
  levelId: AuthoringId;
  start: AuthoringPoint2;
  end: AuthoringPoint2;
  thickness: number;
  height: number;
}

export type AuthoringOpeningKind = "door" | "window" | "opening";

export interface AuthoringOpening extends SourceProvenance {
  id: AuthoringId;
  wallId: AuthoringId;
  kind: AuthoringOpeningKind;
  offset: number;
  width: number;
  height: number;
  sillHeight?: number;
  flip?: boolean;
}

export interface AuthoringSpace extends SourceProvenance {
  id: AuthoringId;
  levelId: AuthoringId;
  name: string;
  unit?: string;
  boundary: readonly AuthoringPoint2[];
  height: number;
}

export interface AuthoringInstance extends SourceProvenance {
  id: AuthoringId;
  levelId?: AuthoringId;
  assetId: AuthoringId;
  placement: "floor" | "wall" | "ceiling" | "site";
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: readonly [number, number, number];
  hostId?: AuthoringId;
}

export interface AuthoringLevel {
  id: AuthoringId;
  buildingId: AuthoringId;
  name: string;
  elevation: number;
  height: number;
}

export interface AuthoringBuilding {
  id: AuthoringId;
  siteId: AuthoringId;
  name: string;
}

export interface AuthoringSite {
  id: AuthoringId;
  name: string;
  boundary?: readonly AuthoringPoint2[];
}

export interface AuthoringDocumentV1 {
  schema: "rekixo-authoring-v1";
  projectId: string;
  revision: number;
  sites: AuthoringSite[];
  buildings: AuthoringBuilding[];
  levels: AuthoringLevel[];
  walls: AuthoringWall[];
  openings: AuthoringOpening[];
  spaces: AuthoringSpace[];
  instances: AuthoringInstance[];
}

export function createAuthoringDocument(projectId: string): AuthoringDocumentV1 {
  if (!projectId.trim()) throw new Error("Authoring project ID is required.");
  return {
    schema: "rekixo-authoring-v1",
    projectId: projectId.trim(),
    revision: 0,
    sites: [],
    buildings: [],
    levels: [],
    walls: [],
    openings: [],
    spaces: [],
    instances: [],
  };
}

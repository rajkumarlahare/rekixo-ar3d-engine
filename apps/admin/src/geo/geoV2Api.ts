const CLOUD_BASE = "/3Dprojects/api/cloud/projects";

export type GeoHeightMode = "ground-clamped" | "ground-relative" | "absolute";
export type GeoAnchorKind =
  | "entrance"
  | "main-gate"
  | "site-center"
  | "south-west-corner"
  | "custom";

export interface GeoV2Anchor {
  id: string;
  sourceBuildingReleaseId: string;
  sourceBuildingReleaseVersion: number;
  kind: GeoAnchorKind;
  name: string;
  xM: number;
  yM: number;
  zM: number;
  updatedBy: string;
  updatedAt: string;
}

export interface GeoV2Draft {
  experienceId: string;
  projectId: string;
  sourceBuildingReleaseId: string;
  sourceBuildingReleaseVersion: number;
  longitude: number | null;
  latitude: number | null;
  altitudeM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  scale: number;
  heightMode: GeoHeightMode;
  eastOffsetM: number;
  northOffsetM: number;
  verticalOffsetM: number;
  modelAnchorId: string | null;
  revision: number;
  updatedBy: string;
  updatedAt: string;
}

export interface GeoV2State {
  schemaReady: boolean;
  project: {
    id: string;
    slug: string;
    name: string;
    status: string;
    activeBuildingReleaseId: string | null;
  };
  experience: {
    id: string;
    lifecycle: string;
    sourceBuildingReleaseId: string;
  } | null;
  draft: GeoV2Draft | null;
  anchors: GeoV2Anchor[];
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error || `Geo V2 request failed (${response.status}).`);
  return body;
}

function endpoint(slug: string, suffix = "") {
  return `${CLOUD_BASE}/${encodeURIComponent(slug)}/geo-v2${suffix}`;
}

export function loadGeoV2(slug: string) {
  return api<GeoV2State>(endpoint(slug));
}

export function saveGeoV2(
  slug: string,
  draft: {
    expectedRevision: number;
    sourceBuildingReleaseId: string;
    longitude: number;
    latitude: number;
    altitudeM: number;
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
    scale: number;
    heightMode: GeoHeightMode;
    eastOffsetM: number;
    northOffsetM: number;
    verticalOffsetM: number;
    modelAnchorId: string | null;
  },
) {
  return api<GeoV2State>(endpoint(slug), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
}

export function createGeoV2Anchor(
  slug: string,
  anchor: {
    sourceBuildingReleaseId: string;
    kind: GeoAnchorKind;
    name: string;
    xM: number;
    yM: number;
    zM: number;
  },
) {
  return api<GeoV2State>(endpoint(slug, "/anchors"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(anchor),
  });
}

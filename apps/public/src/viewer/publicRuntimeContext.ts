import type { PublicSiteElement } from "@rekixo/3d-contracts";

type StudioSiteElement = {
  id?: unknown;
  kind?: unknown;
  x?: unknown;
  y?: unknown;
  z?: unknown;
  width?: unknown;
  depth?: unknown;
  height?: unknown;
  rotation?: unknown;
  color?: unknown;
  shape?: unknown;
  reviewed?: unknown;
};

type StudioScene = {
  scale?: unknown;
  modelTransform?: unknown;
  siteElements?: unknown;
};

const SITE_KINDS = new Set<PublicSiteElement["kind"]>([
  "garden",
  "lawn",
  "path",
  "road",
  "parking",
  "tree",
  "plant",
  "gate",
  "outdoor-light",
  "column",
  "beam",
  "slab",
  "roof",
  "duct",
  "balcony",
  "boundary",
  "stair",
  "lift",
]);

let runtimeSiteElements: PublicSiteElement[] = [];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function color(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function transformFor(scene: StudioScene) {
  const scale = finite(scene.scale) && scene.scale > 0 ? scene.scale : 1;
  const transform =
    scene.modelTransform &&
    typeof scene.modelTransform === "object" &&
    !Array.isArray(scene.modelTransform)
      ? (scene.modelTransform as Record<string, unknown>)
      : {};
  const tx = finite(transform.x) ? transform.x : 0;
  const ty = finite(transform.y) ? transform.y : 0;
  const tz = finite(transform.z) ? transform.z : 0;
  const rotationY = finite(transform.rotationY) ? transform.rotationY : 0;
  const angle = (rotationY * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  const point = (x: number, z: number) => {
    const dx = (x - tx) / scale;
    const dz = (z - tz) / scale;
    return [
      dx * cosine - dz * sine,
      dx * sine + dz * cosine,
    ] as const;
  };
  const pointY = (y: number) => (y - ty) / scale;
  const rotation = (degrees: number) => {
    const tangentX = Math.cos((degrees * Math.PI) / 180);
    const tangentZ = -Math.sin((degrees * Math.PI) / 180);
    const localX = tangentX * cosine - tangentZ * sine;
    const localZ = tangentX * sine + tangentZ * cosine;
    return (Math.atan2(-localZ, localX) * 180) / Math.PI;
  };

  return {
    scale,
    point,
    pointY,
    rotation,
  };
}

export function derivePublicSiteElementsFromStudio(
  project: unknown,
): PublicSiteElement[] {
  if (!project || typeof project !== "object" || Array.isArray(project))
    return [];
  const scene = (project as Record<string, unknown>).scene;
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) return [];
  const studioScene = scene as StudioScene;
  if (!Array.isArray(studioScene.siteElements)) return [];

  const spatial = transformFor(studioScene);
  const result: PublicSiteElement[] = [];
  const ids = new Set<string>();
  for (const raw of studioScene.siteElements as StudioSiteElement[]) {
    if (
      !raw ||
      raw.reviewed !== true ||
      typeof raw.id !== "string" ||
      !raw.id ||
      ids.has(raw.id) ||
      typeof raw.kind !== "string" ||
      !SITE_KINDS.has(raw.kind as PublicSiteElement["kind"]) ||
      !finite(raw.x) ||
      !finite(raw.z) ||
      !finite(raw.width) ||
      raw.width <= 0 ||
      !finite(raw.depth) ||
      raw.depth <= 0 ||
      !finite(raw.height) ||
      raw.height <= 0 ||
      !finite(raw.rotation) ||
      !color(raw.color) ||
      (raw.y !== undefined && !finite(raw.y)) ||
      (raw.shape !== undefined && raw.shape !== "box" && raw.shape !== "cylinder")
    )
      continue;

    const [x, z] = spatial.point(raw.x, raw.z);
    result.push({
      id: raw.id,
      kind: raw.kind as PublicSiteElement["kind"],
      x,
      y: spatial.pointY(finite(raw.y) ? raw.y : 0),
      z,
      width: raw.width / spatial.scale,
      depth: raw.depth / spatial.scale,
      height: raw.height / spatial.scale,
      rotation: spatial.rotation(raw.rotation),
      color: raw.color.toLowerCase(),
      ...(raw.shape === "box" || raw.shape === "cylinder"
        ? { shape: raw.shape }
        : {}),
    });
    ids.add(raw.id);
  }
  return result;
}

export function setPublicRuntimeSiteElements(
  elements: readonly PublicSiteElement[],
) {
  runtimeSiteElements = elements.map((element) => ({ ...element }));
}

export function getPublicRuntimeSiteElements() {
  return runtimeSiteElements.map((element) => ({ ...element }));
}

export function clearPublicRuntimeSiteElements() {
  runtimeSiteElements = [];
}

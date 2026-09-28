export type Kind = "sofa" | "bed" | "table" | "wardrobe" | "plant";
export interface Floor {
  id: string;
  name: string;
  elevation: number;
}
export interface Room {
  id: string;
  name: string;
  floorId: string;
  unit: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  source: string;
  verified: boolean;
  sourceAssetId?: string;
  sourcePackSourceId?: string;
  sourceClaimIds?: string[];
  mesh?: string;
}
export interface Furniture {
  id: string;
  kind: Kind;
  roomId: string;
  x: number;
  z: number;
  rotation: number;
  color: string;
}
export interface Asset {
  id: string;
  projectId: string;
  name: string;
  type: string;
  size: number;
  hash: string;
  blob: Blob;
}
export interface SceneAppearance {
  exposure: number;
  sunIntensity: number;
  hemisphereIntensity: number;
  background: string;
  referenceVisual: boolean;
  nightMode: boolean;
}
export interface MaterialOverride {
  materialName: string;
  baseColor?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
}
export interface ModelTransform {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}
export interface ReferenceLayer {
  id: string;
  assetId: string;
  visible: boolean;
  opacity: number;
  metresPerPixel?: number;
  x: number;
  y: number;
  z: number;
  rotation: number;
}
export interface ModelNodeTag {
  nodeName: string;
  occurrence: number;
  floorId?: string;
  unit?: string;
  roomId?: string;
}
export interface Scene {
  floors: Floor[];
  rooms: Room[];
  furniture: Furniture[];
  modelId?: string;
  scale: number;
  appearance?: SceneAppearance;
  materialOverrides?: MaterialOverride[];
  modelTransform?: ModelTransform;
  referenceLayers?: ReferenceLayer[];
  modelNodeTags?: ModelNodeTag[];
}
export interface Release {
  id: string;
  name: string;
  date: string;
  scene: Scene;
}
export interface Project {
  schema: 1;
  id: string;
  name: string;
  slug?: string;
  location?: string;
  cloud?: {
    revision: number;
    syncedAt: string;
  };
  updated: string;
  scene: Scene;
  assets: string[];
  releases: Release[];
}
export const catalog: Record<
  Kind,
  { name: string; width: number; depth: number; height: number; color: string }
> = {
  sofa: {
    name: "Sofa",
    width: 2.1,
    depth: 0.85,
    height: 0.8,
    color: "#b9a58d",
  },
  bed: {
    name: "Double bed",
    width: 1.6,
    depth: 2,
    height: 0.55,
    color: "#d9d3c4",
  },
  table: {
    name: "Table",
    width: 1.1,
    depth: 0.65,
    height: 0.7,
    color: "#93684c",
  },
  wardrobe: {
    name: "Wardrobe",
    width: 1.5,
    depth: 0.6,
    height: 2.1,
    color: "#8b6d58",
  },
  plant: {
    name: "Plant",
    width: 0.45,
    depth: 0.45,
    height: 1,
    color: "#587958",
  },
};
export const id = () => crypto.randomUUID();
export function slugFromName(name: string) {
  return (
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)
      .replace(/-$/g, "") || "project"
  );
}
export function projectSlug(p: Project) {
  return (
    p.slug ??
    `${slugFromName(p.name)}-${p.id
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 8)
      .toLowerCase()}`
  );
}
export function validStudioSlug(slug: string) {
  return (
    slug.length >= 2 &&
    slug.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    !["studio", "api", "assets", "login", "showcase", "published"].includes(slug)
  );
}
export function duplicateFloor(p: Project, floorId: string): Project {
  const next = structuredClone(p);
  const floor = next.scene.floors.find((f) => f.id === floorId);
  if (!floor) throw Error("Select a floor to copy.");
  const rooms = next.scene.rooms.filter((r) => r.floorId === floorId);
  const height = Math.max(3, ...next.scene.rooms.map((r) => r.height));
  const newFloor = {
    ...floor,
    id: id(),
    name: `${floor.name} copy`,
    elevation: Math.max(...next.scene.floors.map((f) => f.elevation)) + height,
  };
  const remap = new Map(rooms.map((r) => [r.id, id()]));
  next.scene.floors.push(newFloor);
  next.scene.rooms.push(
    ...rooms.map((r) => ({
      ...r,
      id: remap.get(r.id)!,
      floorId: newFloor.id,
      unit: `${r.unit} copy`,
      verified: false,
      sourceAssetId: undefined,
      sourcePackSourceId: undefined,
      sourceClaimIds: undefined,
      mesh: undefined,
    })),
  );
  next.scene.furniture.push(
    ...p.scene.furniture
      .filter((f) => remap.has(f.roomId))
      .map((f) => ({ ...f, id: id(), roomId: remap.get(f.roomId)! })),
  );
  validateProject(next);
  return next;
}
export function newProject(name: string): Project {
  return {
    schema: 1,
    id: id(),
    name: name.trim(),
    location: "",
    updated: new Date().toISOString(),
    assets: [],
    releases: [],
    scene: {
      scale: 1,
      appearance: {
        exposure: 1,
        sunIntensity: 3.2,
        hemisphereIntensity: 2.8,
        background: "#dbe3e7",
        referenceVisual: true,
        nightMode: false,
      },
      materialOverrides: [],
      modelTransform: { x: 0, y: 0, z: 0, rotationY: 0 },
      referenceLayers: [],
      modelNodeTags: [],
      floors: [{ id: id(), name: "Ground", elevation: 0 }],
      rooms: [],
      furniture: [],
    },
  };
}
const number = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const color = (v: unknown) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const unique = (items: { id: string }[]) =>
  new Set(items.map((i) => i.id)).size === items.length &&
  items.every((i) => text(i.id, 100));
export function validateScene(s: Scene): void {
  if (
    !s ||
    !Array.isArray(s.floors) ||
    !s.floors.length ||
    s.floors.length > 100 ||
    !Array.isArray(s.rooms) ||
    s.rooms.length > 500 ||
    !Array.isArray(s.furniture) ||
    s.furniture.length > 2000 ||
    !number(s.scale, 0.0001, 10000)
  )
    throw Error("Invalid scene or scene limits exceeded.");
  if (!unique(s.floors) || !unique(s.rooms) || !unique(s.furniture))
    throw Error("Duplicate or invalid object IDs.");
  if (s.modelId !== undefined && !text(s.modelId, 100))
    throw Error("Invalid model reference.");
  if (
    s.appearance !== undefined &&
    (!s.appearance ||
      !number(s.appearance.exposure, 0.1, 4) ||
      !number(s.appearance.sunIntensity, 0, 30) ||
      !number(s.appearance.hemisphereIntensity, 0, 30) ||
      !color(s.appearance.background) ||
      typeof s.appearance.referenceVisual !== "boolean" ||
      typeof s.appearance.nightMode !== "boolean")
  )
    throw Error("Invalid scene appearance settings.");
  if (s.materialOverrides !== undefined) {
    if (
      !Array.isArray(s.materialOverrides) ||
      s.materialOverrides.length > 250 ||
      new Set(s.materialOverrides.map((item) => item.materialName)).size !==
        s.materialOverrides.length
    )
      throw Error("Invalid material overrides.");
    for (const material of s.materialOverrides) {
      if (
        !text(material.materialName, 300) ||
        (material.baseColor !== undefined && !color(material.baseColor)) ||
        (material.roughness !== undefined &&
          !number(material.roughness, 0, 1)) ||
        (material.metalness !== undefined &&
          !number(material.metalness, 0, 1)) ||
        (material.opacity !== undefined && !number(material.opacity, 0.02, 1)) ||
        (material.emissive !== undefined && !color(material.emissive)) ||
        (material.emissiveIntensity !== undefined &&
          !number(material.emissiveIntensity, 0, 20))
      )
        throw Error("Invalid material override values.");
    }
  }
  if (
    s.modelTransform !== undefined &&
    (!s.modelTransform ||
      !number(s.modelTransform.x, -10000, 10000) ||
      !number(s.modelTransform.y, -10000, 10000) ||
      !number(s.modelTransform.z, -10000, 10000) ||
      !number(s.modelTransform.rotationY, -3600, 3600))
  )
    throw Error("Invalid model alignment transform.");
  if (s.referenceLayers !== undefined) {
    if (
      !Array.isArray(s.referenceLayers) ||
      s.referenceLayers.length > 100 ||
      !unique(s.referenceLayers)
    )
      throw Error("Invalid reference layers.");
    for (const layer of s.referenceLayers) {
      if (
        !text(layer.assetId, 100) ||
        typeof layer.visible !== "boolean" ||
        !number(layer.opacity, 0.02, 1) ||
        (layer.metresPerPixel !== undefined &&
          !number(layer.metresPerPixel, 0.0000001, 1000)) ||
        !number(layer.x, -1000000, 1000000) ||
        !number(layer.y, -10000, 100000) ||
        !number(layer.z, -1000000, 1000000) ||
        !number(layer.rotation, -3600, 3600)
      )
        throw Error("Invalid reference layer settings.");
    }
  }
  if (s.modelNodeTags !== undefined) {
    if (
      !Array.isArray(s.modelNodeTags) ||
      s.modelNodeTags.length > 5000 ||
      new Set(
        s.modelNodeTags.map(
          (tag) => `${tag.nodeName}\u0000${tag.occurrence}`,
        ),
      ).size !== s.modelNodeTags.length
    )
      throw Error("Invalid model node tags.");
    for (const tag of s.modelNodeTags) {
      const room = tag.roomId
        ? s.rooms.find((candidate) => candidate.id === tag.roomId)
        : undefined;
      if (
        !text(tag.nodeName, 500) ||
        !Number.isInteger(tag.occurrence) ||
        tag.occurrence < 1 ||
        tag.occurrence > 100000 ||
        (tag.floorId !== undefined &&
          !s.floors.some((floor) => floor.id === tag.floorId)) ||
        (tag.unit !== undefined &&
          (typeof tag.unit !== "string" || tag.unit.length > 120)) ||
        (tag.roomId !== undefined && !room) ||
        (room && tag.floorId !== undefined && room.floorId !== tag.floorId) ||
        (room &&
          tag.unit !== undefined &&
          tag.unit.trim() &&
          room.unit !== tag.unit.trim())
      )
        throw Error("Invalid model node floor/unit tag.");
    }
  }
  for (const f of s.floors)
    if (!text(f.name) || !number(f.elevation, -500, 2000))
      throw Error("Invalid floor elevation or name.");
  for (const r of s.rooms)
    if (
      !text(r.name) ||
      !text(r.unit) ||
      !s.floors.some((f) => f.id === r.floorId) ||
      !number(r.x, -10000, 10000) ||
      !number(r.z, -10000, 10000) ||
      !number(r.width, 0.5, 200) ||
      !number(r.depth, 0.5, 200) ||
      !number(r.height, 1.8, 20) ||
      !color(r.color) ||
      typeof r.source !== "string" ||
      r.source.length > 2000 ||
      typeof r.verified !== "boolean" ||
      (r.verified &&
        !r.source.trim() &&
        !r.sourceAssetId &&
        !r.sourcePackSourceId) ||
      (r.sourceAssetId !== undefined && !text(r.sourceAssetId, 100)) ||
      (r.sourcePackSourceId !== undefined &&
        !text(r.sourcePackSourceId, 200)) ||
      (r.sourceClaimIds !== undefined &&
        (!Array.isArray(r.sourceClaimIds) ||
          r.sourceClaimIds.length > 100 ||
          new Set(r.sourceClaimIds).size !== r.sourceClaimIds.length ||
          r.sourceClaimIds.some((claim) => !text(claim, 200)))) ||
      (r.sourceClaimIds?.length && !r.sourcePackSourceId) ||
      (r.mesh !== undefined && !text(r.mesh, 500))
    )
      throw Error("Check room dimensions, floor and measurement source.");
  for (const f of s.furniture) {
    const r = s.rooms.find((r) => r.id === f.roomId);
    if (
      !Object.hasOwn(catalog, f.kind) ||
      !r ||
      !number(f.rotation, -360, 360) ||
      !color(f.color) ||
      !number(f.x, -200, 200) ||
      !number(f.z, -200, 200)
    )
      throw Error("Invalid furniture or room reference.");
    const ext = furnitureExtents(f);
    if (
      Math.abs(f.x) + ext.x > r.width / 2 + 0.001 ||
      Math.abs(f.z) + ext.z > r.depth / 2 + 0.001
    )
      throw Error(`${catalog[f.kind].name} must fit inside ${r.name}.`);
  }
}
export function furnitureExtents(f: Furniture) {
  const c = catalog[f.kind],
    a = (f.rotation * Math.PI) / 180;
  return {
    x: (Math.abs(Math.cos(a)) * c.width + Math.abs(Math.sin(a)) * c.depth) / 2,
    z: (Math.abs(Math.sin(a)) * c.width + Math.abs(Math.cos(a)) * c.depth) / 2,
  };
}
export function validateProject(p: Project): void {
  if (
    !p ||
    p.schema !== 1 ||
    !text(p.id, 100) ||
    !text(p.name) ||
    (p.location !== undefined &&
      (typeof p.location !== "string" || p.location.length > 180)) ||
    (p.cloud !== undefined &&
      (!p.cloud ||
        !Number.isInteger(p.cloud.revision) ||
        p.cloud.revision < 1 ||
        !text(p.cloud.syncedAt, 100))) ||
    !text(p.updated) ||
    !Array.isArray(p.assets) ||
    p.assets.length > 100 ||
    p.assets.some((a) => !text(a, 100)) ||
    new Set(p.assets).size !== p.assets.length ||
    !Array.isArray(p.releases) ||
    p.releases.length > 30 ||
    !unique(p.releases)
  )
    throw Error("Invalid project package.");
  if (
    p.slug !== undefined &&
    (typeof p.slug !== "string" || !validStudioSlug(p.slug))
  )
    throw Error(
      "Use a unique slug of 2–80 lowercase letters, numbers and hyphens. studio, api and assets are reserved.",
    );
  validateScene(p.scene);
  for (const r of p.releases) {
    if (!text(r.name) || !text(r.date)) throw Error("Invalid review version.");
    validateScene(r.scene);
  }
  for (const s of [p.scene, ...p.releases.map((r) => r.scene)]) {
    if (s.modelId && !p.assets.includes(s.modelId))
      throw Error("Model asset is missing.");
    for (const layer of s.referenceLayers ?? [])
      if (!p.assets.includes(layer.assetId))
        throw Error("Reference layer asset is missing.");
    for (const room of s.rooms)
      if (room.sourceAssetId && !p.assets.includes(room.sourceAssetId))
        throw Error("Room source asset is missing.");
  }
}
export function snapshot(p: Project, name: string): Project {
  validateProject(p);
  if (p.releases.length >= 30)
    throw Error(
      "Export a backup before creating more than 30 review versions.",
    );
  if (!p.scene.rooms.length)
    throw Error("Add at least one room before creating a review version.");
  return {
    ...p,
    releases: [
      ...p.releases,
      {
        id: id(),
        name: name.trim() || `Review ${p.releases.length + 1}`,
        date: new Date().toISOString(),
        scene: structuredClone(p.scene),
      },
    ],
  };
}
// Walking is deliberately room-bounded in this release; no inferred door links.
export function canWalk(scene: Scene, room: Room, x: number, z: number) {
  const margin = 0.18;
  if (
    Math.abs(x - room.x) > room.width / 2 - margin ||
    Math.abs(z - room.z) > room.depth / 2 - margin
  )
    return false;
  return !scene.furniture
    .filter((f) => f.roomId === room.id)
    .some((f) => {
      const a = (-f.rotation * Math.PI) / 180,
        dx = x - room.x - f.x,
        dz = z - room.z - f.z;
      const lx = dx * Math.cos(a) + dz * Math.sin(a),
        lz = -dx * Math.sin(a) + dz * Math.cos(a),
        c = catalog[f.kind];
      return (
        Math.abs(lx) < c.width / 2 + margin &&
        Math.abs(lz) < c.depth / 2 + margin
      );
    });
}

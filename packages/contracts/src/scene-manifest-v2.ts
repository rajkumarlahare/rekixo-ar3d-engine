export const SCENE_MANIFEST_FORMAT = "rekixo-scene-manifest" as const;
export const SCENE_MANIFEST_VERSION = 2 as const;

export type SceneReviewStatusV2 = "unverified" | "reviewed";
export type SceneAssetRoleV2 =
  | "model"
  | "reference"
  | "texture"
  | "catalog"
  | "other";
export type SceneModelRoleV2 = "shell" | "interior" | "context" | "other";
export type SceneOpeningKindV2 = "door" | "window" | "opening";

export interface SceneTransformV2 {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface SceneAssetV2 {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  role: SceneAssetRoleV2;
}

export interface SceneModelV2 {
  id: string;
  assetId: string;
  role: SceneModelRoleV2;
  transform: SceneTransformV2;
}

export interface SceneSiteV2 {
  id: string;
  name: string;
}

export interface SceneBuildingV2 {
  id: string;
  siteId: string;
  name: string;
}

export interface SceneFloorV2 {
  id: string;
  buildingId: string;
  name: string;
  elevationM: number;
}

export interface SceneUnitV2 {
  id: string;
  floorId: string;
  name: string;
}

export type SceneRoomBoundaryV2 =
  | {
      kind: "rectangle";
      center: [number, number];
      size: [number, number];
    }
  | {
      kind: "polygon";
      points: Array<[number, number]>;
    };

export interface SceneMeasurementEvidenceV2 {
  status: SceneReviewStatusV2;
  sourceNote?: string;
  sourceAssetId?: string;
  sourcePackSourceId?: string;
  sourceClaimIds?: string[];
  basis?: string;
}

export interface SceneMeshBindingV2 {
  modelId: string;
  strategy: "semantic-id" | "source-node-name";
  key: string;
}

export interface SceneRoomV2 {
  id: string;
  floorId: string;
  unitId?: string;
  name: string;
  boundary: SceneRoomBoundaryV2;
  ceilingHeightM: number;
  evidence: SceneMeasurementEvidenceV2;
  meshBindings: SceneMeshBindingV2[];
  finish?: {
    color?: string;
    materialId?: string;
  };
}

export interface SceneOpeningV2 {
  id: string;
  floorId: string;
  kind: SceneOpeningKindV2;
  roomIds: string[];
  position: [number, number, number];
  widthM: number;
  heightM: number;
  sillHeightM?: number;
}

export interface SceneFurnitureV2 {
  id: string;
  roomId: string;
  catalogKey: string;
  transform: SceneTransformV2;
  finish?: {
    color?: string;
    materialId?: string;
  };
}

export interface SceneMaterialV2 {
  id: string;
  name: string;
  baseColor?: string;
}

export interface SceneCameraV2 {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
  roomId?: string;
}

export interface SceneManifestV2 {
  format: typeof SCENE_MANIFEST_FORMAT;
  version: typeof SCENE_MANIFEST_VERSION;
  project: {
    id: string;
    slug: string;
    name: string;
  };
  coordinateSystem: {
    linearUnit: "metre";
    upAxis: "Y";
    handedness: "right";
    modelScaleToMetres: number;
  };
  assets: SceneAssetV2[];
  models: SceneModelV2[];
  sites: SceneSiteV2[];
  buildings: SceneBuildingV2[];
  floors: SceneFloorV2[];
  units: SceneUnitV2[];
  rooms: SceneRoomV2[];
  openings: SceneOpeningV2[];
  furniture: SceneFurnitureV2[];
  materials: SceneMaterialV2[];
  cameras: SceneCameraV2[];
}

const MAX = {
  assets: 500,
  models: 50,
  sites: 50,
  buildings: 250,
  floors: 1000,
  units: 10000,
  rooms: 25000,
  openings: 50000,
  furniture: 100000,
  materials: 10000,
  cameras: 5000,
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown, max = 500) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isNumber = (value: unknown, min = -1e9, max = 1e9) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
const isVector = (value: unknown, size: number, min = -1e9, max = 1e9) =>
  Array.isArray(value) &&
  value.length === size &&
  value.every((item) => isNumber(item, min, max));
const isColor = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const hasUniqueIds = (items: unknown[]) => {
  const ids = new Set<string>();
  for (const item of items) {
    if (!isObject(item) || !isText(item.id, 160) || ids.has(item.id as string))
      return false;
    ids.add(item.id as string);
  }
  return true;
};

function requireArray(
  root: Record<string, unknown>,
  key: keyof typeof MAX,
): unknown[] {
  const value = root[key];
  if (!Array.isArray(value) || value.length > MAX[key] || !hasUniqueIds(value))
    throw Error(`Invalid scene manifest ${key}.`);
  return value;
}

function idSet(items: unknown[]) {
  return new Set(items.map((item) => (item as Record<string, unknown>).id as string));
}

function validateTransform(value: unknown) {
  if (
    !isObject(value) ||
    !isVector(value.position, 3) ||
    !isVector(value.rotation, 3, -Math.PI * 8, Math.PI * 8) ||
    !isVector(value.scale, 3, 0.000001, 1e6)
  )
    throw Error("Invalid scene transform.");
}

function samePoint(
  left: readonly number[],
  right: readonly number[],
  epsilon = 1e-9,
) {
  return (
    Math.abs(left[0] - right[0]) <= epsilon &&
    Math.abs(left[1] - right[1]) <= epsilon
  );
}

function polygonArea(points: readonly (readonly number[])[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return Math.abs(area) / 2;
}

function orientation(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
) {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(
  a: readonly number[],
  b: readonly number[],
  point: readonly number[],
  epsilon = 1e-9,
) {
  return (
    Math.min(a[0], b[0]) - epsilon <= point[0] &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    Math.min(a[1], b[1]) - epsilon <= point[1] &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  );
}

function segmentsIntersect(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  d: readonly number[],
) {
  const epsilon = 1e-9;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);

  if (
    ((abC > epsilon && abD < -epsilon) ||
      (abC < -epsilon && abD > epsilon)) &&
    ((cdA > epsilon && cdB < -epsilon) ||
      (cdA < -epsilon && cdB > epsilon))
  )
    return true;

  if (Math.abs(abC) <= epsilon && onSegment(a, b, c)) return true;
  if (Math.abs(abD) <= epsilon && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) <= epsilon && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) <= epsilon && onSegment(c, d, b)) return true;
  return false;
}

function validSimplePolygon(points: readonly (readonly number[])[]) {
  if (points.length < 3 || polygonArea(points) <= 1e-6) return false;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    if (samePoint(points[index], points[next])) return false;
  }
  if (samePoint(points[0], points[points.length - 1])) return false;

  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length;
      if (
        left === right ||
        leftNext === right ||
        rightNext === left
      )
        continue;
      if (
        left === 0 &&
        rightNext === 0
      )
        continue;
      if (
        segmentsIntersect(
          points[left],
          points[leftNext],
          points[right],
          points[rightNext],
        )
      )
        return false;
    }
  }
  return true;
}

export function assertSceneManifestV2(
  value: unknown,
): asserts value is SceneManifestV2 {
  if (!isObject(value)) throw Error("Scene manifest must be an object.");
  if (
    value.format !== SCENE_MANIFEST_FORMAT ||
    value.version !== SCENE_MANIFEST_VERSION
  )
    throw Error("Unsupported scene manifest version.");

  const project = value.project;
  if (
    !isObject(project) ||
    !isText(project.id, 160) ||
    !isText(project.name, 300) ||
    !isText(project.slug, 100) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug as string)
  )
    throw Error("Invalid scene manifest project.");

  const coordinates = value.coordinateSystem;
  if (
    !isObject(coordinates) ||
    coordinates.linearUnit !== "metre" ||
    coordinates.upAxis !== "Y" ||
    coordinates.handedness !== "right" ||
    !isNumber(coordinates.modelScaleToMetres, 0.000001, 1e6)
  )
    throw Error("Invalid scene coordinate system.");

  const assets = requireArray(value, "assets");
  const models = requireArray(value, "models");
  const sites = requireArray(value, "sites");
  const buildings = requireArray(value, "buildings");
  const floors = requireArray(value, "floors");
  const units = requireArray(value, "units");
  const rooms = requireArray(value, "rooms");
  const openings = requireArray(value, "openings");
  const furniture = requireArray(value, "furniture");
  const materials = requireArray(value, "materials");
  const cameras = requireArray(value, "cameras");

  if (!sites.length || !buildings.length || !floors.length)
    throw Error("Scene manifest needs a site, building and floor.");

  const assetIds = idSet(assets);
  const assetById = new Map(
    assets.map((item) => [
      (item as Record<string, unknown>).id as string,
      item as Record<string, unknown>,
    ]),
  );
  const modelIds = idSet(models);
  const siteIds = idSet(sites);
  const buildingIds = idSet(buildings);
  const floorIds = idSet(floors);
  const unitIds = idSet(units);
  const unitById = new Map(
    units.map((item) => [
      (item as Record<string, unknown>).id as string,
      item as Record<string, unknown>,
    ]),
  );
  const roomById = new Map(
    rooms.map((item) => [
      (item as Record<string, unknown>).id as string,
      item as Record<string, unknown>,
    ]),
  );
  const materialIds = idSet(materials);

  for (const item of assets) {
    const a = item as Record<string, unknown>;
    if (
      !isText(a.name, 500) ||
      typeof a.mimeType !== "string" ||
      a.mimeType.length > 200 ||
      !isNumber(a.byteSize, 0, 1024 ** 4) ||
      typeof a.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(a.sha256) ||
      !["model", "reference", "texture", "catalog", "other"].includes(
        a.role as string,
      )
    )
      throw Error("Invalid scene asset.");
  }

  for (const item of models) {
    const m = item as Record<string, unknown>;
    const modelAsset = assetById.get(m.assetId as string);
    if (
      !modelAsset ||
      modelAsset.role !== "model" ||
      !["shell", "interior", "context", "other"].includes(m.role as string)
    )
      throw Error("Invalid scene model.");
    validateTransform(m.transform);
  }

  for (const item of sites) {
    const site = item as Record<string, unknown>;
    if (!isText(site.name, 300)) throw Error("Invalid scene site.");
  }

  for (const item of buildings) {
    const building = item as Record<string, unknown>;
    if (
      !siteIds.has(building.siteId as string) ||
      !isText(building.name, 300)
    )
      throw Error("Invalid scene building.");
  }

  for (const item of floors) {
    const floor = item as Record<string, unknown>;
    if (
      !buildingIds.has(floor.buildingId as string) ||
      !isText(floor.name, 300) ||
      !isNumber(floor.elevationM, -10000, 100000)
    )
      throw Error("Invalid scene floor.");
  }

  for (const item of units) {
    const unit = item as Record<string, unknown>;
    if (!floorIds.has(unit.floorId as string) || !isText(unit.name, 300))
      throw Error("Invalid scene unit.");
  }

  for (const item of rooms) {
    const room = item as Record<string, unknown>;
    const roomUnit =
      room.unitId === undefined
        ? undefined
        : unitById.get(room.unitId as string);
    if (
      !floorIds.has(room.floorId as string) ||
      (room.unitId !== undefined && !roomUnit) ||
      (roomUnit !== undefined &&
        roomUnit.floorId !== room.floorId) ||
      !isText(room.name, 300) ||
      !isNumber(room.ceilingHeightM, 1, 100) ||
      !Array.isArray(room.meshBindings) ||
      room.meshBindings.length > 50 ||
      !isObject(room.boundary) ||
      !isObject(room.evidence)
    )
      throw Error("Invalid scene room.");

    const boundary = room.boundary as Record<string, unknown>;
    if (boundary.kind === "rectangle") {
      if (
        !isVector(boundary.center, 2, -1e6, 1e6) ||
        !isVector(boundary.size, 2, 0.01, 1e5)
      )
        throw Error("Invalid rectangular room boundary.");
    } else if (boundary.kind === "polygon") {
      if (
        !Array.isArray(boundary.points) ||
        boundary.points.length < 3 ||
        boundary.points.length > 256 ||
        !boundary.points.every((point) => isVector(point, 2, -1e6, 1e6)) ||
        !validSimplePolygon(boundary.points as number[][])
      )
        throw Error("Invalid polygon room boundary.");
    } else {
      throw Error("Unsupported room boundary.");
    }

    const evidence = room.evidence as Record<string, unknown>;
    const sourceClaimIds = evidence.sourceClaimIds;
    if (
      !["unverified", "reviewed"].includes(evidence.status as string) ||
      (evidence.sourceNote !== undefined &&
        (typeof evidence.sourceNote !== "string" ||
          evidence.sourceNote.length > 4000)) ||
      (evidence.sourceAssetId !== undefined &&
        !assetIds.has(evidence.sourceAssetId as string)) ||
      (evidence.sourcePackSourceId !== undefined &&
        !isText(evidence.sourcePackSourceId, 200)) ||
      (sourceClaimIds !== undefined &&
        (!Array.isArray(sourceClaimIds) ||
          sourceClaimIds.length > 100 ||
          new Set(sourceClaimIds as unknown[]).size !== sourceClaimIds.length ||
          sourceClaimIds.some((id) => !isText(id, 200)))) ||
      (Array.isArray(sourceClaimIds) &&
        sourceClaimIds.length > 0 &&
        evidence.sourcePackSourceId === undefined) ||
      (evidence.basis !== undefined &&
        (typeof evidence.basis !== "string" || evidence.basis.length > 1000))
    )
      throw Error("Invalid room evidence.");
    if (
      evidence.status === "reviewed" &&
      !(
        (typeof evidence.sourceNote === "string" &&
          evidence.sourceNote.trim().length) ||
        evidence.sourceAssetId ||
        evidence.sourcePackSourceId
      )
    )
      throw Error("Reviewed room measurements require evidence.");

    for (const binding of room.meshBindings) {
      if (
        !isObject(binding) ||
        !modelIds.has(binding.modelId as string) ||
        !["semantic-id", "source-node-name"].includes(binding.strategy as string) ||
        !isText(binding.key, 1000)
      )
        throw Error("Invalid room mesh binding.");
    }

    if (room.finish !== undefined) {
      if (!isObject(room.finish)) throw Error("Invalid room finish.");
      const finish = room.finish as Record<string, unknown>;
      if (finish.color !== undefined && !isColor(finish.color))
        throw Error("Invalid room finish color.");
      if (
        finish.materialId !== undefined &&
        !materialIds.has(finish.materialId as string)
      )
        throw Error("Invalid room material.");
    }
  }

  for (const item of openings) {
    const opening = item as Record<string, unknown>;
    const openingRooms = Array.isArray(opening.roomIds)
      ? opening.roomIds.map((id) => roomById.get(id as string))
      : [];
    if (
      !floorIds.has(opening.floorId as string) ||
      !["door", "window", "opening"].includes(opening.kind as string) ||
      !Array.isArray(opening.roomIds) ||
      opening.roomIds.length < 1 ||
      opening.roomIds.length > 2 ||
      new Set(opening.roomIds as unknown[]).size !== opening.roomIds.length ||
      openingRooms.some((room) => !room) ||
      openingRooms.some((room) => room?.floorId !== opening.floorId) ||
      !isVector(opening.position, 3, -1e6, 1e6) ||
      !isNumber(opening.widthM, 0.01, 100) ||
      !isNumber(opening.heightM, 0.01, 100) ||
      (opening.sillHeightM !== undefined &&
        !isNumber(opening.sillHeightM, 0, 100))
    )
      throw Error("Invalid scene opening.");
  }

  for (const item of furniture) {
    const instance = item as Record<string, unknown>;
    if (
      !roomIds.has(instance.roomId as string) ||
      !isText(instance.catalogKey, 300)
    )
      throw Error("Invalid scene furniture.");
    validateTransform(instance.transform);
    if (instance.finish !== undefined) {
      if (!isObject(instance.finish)) throw Error("Invalid furniture finish.");
      const finish = instance.finish as Record<string, unknown>;
      if (finish.color !== undefined && !isColor(finish.color))
        throw Error("Invalid furniture finish color.");
      if (
        finish.materialId !== undefined &&
        !materialIds.has(finish.materialId as string)
      )
        throw Error("Invalid furniture material.");
    }
  }

  for (const item of materials) {
    const material = item as Record<string, unknown>;
    if (
      !isText(material.name, 300) ||
      (material.baseColor !== undefined && !isColor(material.baseColor))
    )
      throw Error("Invalid scene material.");
  }

  for (const item of cameras) {
    const camera = item as Record<string, unknown>;
    if (
      !isText(camera.name, 300) ||
      !isVector(camera.position, 3, -1e6, 1e6) ||
      !isVector(camera.target, 3, -1e6, 1e6) ||
      (camera.fov !== undefined && !isNumber(camera.fov, 1, 179)) ||
      (camera.roomId !== undefined && !roomIds.has(camera.roomId as string))
    )
      throw Error("Invalid scene camera.");
  }
}

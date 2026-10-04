import type {
  Asset,
  Floor,
  Opening,
  Project,
  ReferenceImageEvidence,
  Room,
  RoomPoint,
  SiteElement,
  Wall,
} from "./domain";

export interface NormalizedSceneFingerprint {
  schema: 1;
  kind: "rekixo-normalized-scene-fingerprint";
  algorithm: "sha256";
  normalization: "scene-v1";
  hash: string;
  entityCounts: {
    floors: number;
    rooms: number;
    walls: number;
    openings: number;
    furniture: number;
    siteElements: number;
    referenceLayers: number;
    modelNodeTags: number;
  };
}

export interface DeterministicReplayCertification {
  state: "pending" | "passed" | "blocked";
  runs: number;
  normalization: "scene-v1";
  hash?: string;
  mismatchedHashes: string[];
  detail: string;
}

const round = (value: number) => Number(value.toFixed(6));
const point = ([x, z]: RoomPoint): RoomPoint => [round(x), round(z)];

function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((row) => stableStringify(row)).join(",")}]`;
  if (value && typeof value === "object") {
    const rows = Object.entries(value as Record<string, unknown>)
      .filter(([, row]) => row !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${rows
      .map(([key, row]) => `${JSON.stringify(key)}:${stableStringify(row)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sortByCanonical<T>(values: readonly T[], project: (value: T) => unknown) {
  return [...values].sort((left, right) =>
    stableStringify(project(left)).localeCompare(stableStringify(project(right))),
  );
}

function canonicalBoundary(room: Room) {
  const raw = room.polygon?.length
    ? room.polygon.map(point)
    : [
        [round(room.x - room.width / 2), round(room.z - room.depth / 2)],
        [round(room.x + room.width / 2), round(room.z - room.depth / 2)],
        [round(room.x + room.width / 2), round(room.z + room.depth / 2)],
        [round(room.x - room.width / 2), round(room.z + room.depth / 2)],
      ];
  if (!raw.length) return [];

  const variants: RoomPoint[][] = [];
  for (const candidate of [raw, [...raw].reverse()]) {
    for (let index = 0; index < candidate.length; index += 1)
      variants.push([...candidate.slice(index), ...candidate.slice(0, index)] as RoomPoint[]);
  }
  return variants.sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right)),
  )[0];
}

function undirectedWallPoints(wall: Wall) {
  const start = point(wall.start);
  const end = point(wall.end);
  return stableStringify(start) <= stableStringify(end)
    ? [start, end]
    : [end, start];
}

function extension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "unknown";
}

function buildAssetIdentity(files: readonly Asset[]) {
  const identities = new Map<string, string>();
  for (const file of files) {
    const sha = /^[a-f0-9]{64}$/i.test(file.hash)
      ? file.hash.toLowerCase()
      : "unverified";
    identities.set(file.id, `${extension(file.name)}:${file.size}:${sha}`);
  }
  return (assetId?: string) =>
    assetId ? (identities.get(assetId) ?? `unresolved:${assetId}`) : undefined;
}

function floorSeed(floor: Floor) {
  return {
    name: floor.name.trim(),
    elevation: round(floor.elevation),
    repeatConfidence:
      floor.repeatConfidence === undefined ? undefined : round(floor.repeatConfidence),
    repeatReviewed: floor.repeatReviewed,
    repeatReviewState: floor.repeatReviewState,
  };
}

function roomSeed(room: Room, floorRef: (id: string) => string) {
  return {
    floor: floorRef(room.floorId),
    name: room.name.trim(),
    unit: room.unit.trim(),
    boundary: canonicalBoundary(room),
    height: round(room.height),
    verified: room.verified,
  };
}

function wallSeed(
  wall: Wall,
  floorRef: (id: string) => string,
  roomRef: (id: string) => string,
) {
  return {
    floor: floorRef(wall.floorId),
    rooms: wall.roomIds.map(roomRef).sort(),
    segment: undirectedWallPoints(wall),
    thickness: round(wall.thickness),
    height: round(wall.height),
    reviewed: wall.reviewed,
    origin: wall.origin,
    confidence: wall.confidence === undefined ? undefined : round(wall.confidence),
    reviewState: wall.reviewState,
  };
}

function openingSeed(
  opening: Opening,
  floorRef: (id: string) => string,
  roomRef: (id: string) => string,
) {
  return {
    floor: floorRef(opening.floorId),
    kind: opening.kind,
    rooms: opening.roomIds.map(roomRef).sort(),
    x: round(opening.x),
    y: round(opening.y),
    z: round(opening.z),
    width: round(opening.width),
    height: round(opening.height),
    sillHeight:
      opening.sillHeight === undefined ? undefined : round(opening.sillHeight),
    rotationY: round(opening.rotationY),
    reviewed: opening.reviewed,
    confidence:
      opening.confidence === undefined ? undefined : round(opening.confidence),
    reviewState: opening.reviewState,
  };
}

function siteSeed(
  site: SiteElement,
  floorRef: (id: string) => string,
  assetRef: (id?: string) => string | undefined,
) {
  return {
    kind: site.kind,
    floor: site.floorId ? floorRef(site.floorId) : undefined,
    x: round(site.x),
    y: site.y === undefined ? undefined : round(site.y),
    z: round(site.z),
    width: round(site.width),
    depth: round(site.depth),
    height: round(site.height),
    rotation: round(site.rotation),
    reviewed: site.reviewed,
    reviewState: site.reviewState,
    origin: site.origin,
    confidence: site.confidence === undefined ? undefined : round(site.confidence),
    shape: site.shape,
    source: assetRef(site.sourceAssetId),
  };
}

function referenceEvidenceSeed(evidence: ReferenceImageEvidence, assetRef: (id?: string) => string | undefined) {
  return {
    source: assetRef(evidence.assetId),
    palette: [...evidence.renderedPalette].map((row) => row.toLowerCase()).sort(),
    regions: [...(evidence.regions ?? [])].sort((left, right) => left.id.localeCompare(right.id)).map((region) => ({
      id: region.id, color: region.color.toLowerCase(), coverage: round(region.coverage),
      centroidX: round(region.centroidX), centroidY: round(region.centroidY),
      minX: round(region.minX), minY: round(region.minY), maxX: round(region.maxX), maxY: round(region.maxY),
      confidence: round(region.confidence),
    })),
    averageLuminance: round(evidence.averageLuminance), warmFraction: round(evidence.warmFraction),
    darkFraction: round(evidence.darkFraction), highlightFraction: round(evidence.highlightFraction),
    averageSaturation: round(evidence.averageSaturation),
    verticalEdgeStrength: round(evidence.verticalEdgeStrength), horizontalEdgeStrength: round(evidence.horizontalEdgeStrength),
    lightingMood: evidence.lightingMood, confidence: round(evidence.confidence),
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((row) => row.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Produces a project-neutral semantic fingerprint of the editable scene.
 * Random project/entity IDs, timestamps, cloud revisions and array insertion
 * order are normalized away. Geometry/evidence bindings remain represented.
 */
export async function buildNormalizedSceneFingerprint(
  project: Project,
  files: readonly Asset[] = [],
): Promise<NormalizedSceneFingerprint> {
  const assetRef = buildAssetIdentity(files);

  const floors = sortByCanonical(project.scene.floors, floorSeed);
  const floorIds = new Map(floors.map((floor, index) => [floor.id, `f${index}`]));
  const floorRef = (id: string) => floorIds.get(id) ?? `missing-floor:${id}`;

  const rooms = sortByCanonical(project.scene.rooms, (room) => roomSeed(room, floorRef));
  const roomIds = new Map(rooms.map((room, index) => [room.id, `r${index}`]));
  const roomRef = (id: string) => roomIds.get(id) ?? `missing-room:${id}`;

  const normalizedFloors = floors.map((floor) => ({
    ...floorSeed(floor),
    repeatOf: floor.repeatOfFloorId ? floorRef(floor.repeatOfFloorId) : undefined,
  }));
  const normalizedRooms = rooms.map((room) => ({
    ...roomSeed(room, floorRef),
    sourceAsset: assetRef(room.sourceAssetId),
    sourcePackBound: Boolean(room.sourcePackSourceId),
    sourceClaimCount: room.sourceClaimIds?.length ?? 0,
    mesh: room.mesh,
  }));
  const normalizedWalls = sortByCanonical(project.scene.walls ?? [], (wall) =>
    wallSeed(wall, floorRef, roomRef),
  ).map((wall) => wallSeed(wall, floorRef, roomRef));
  const normalizedOpenings = sortByCanonical(
    project.scene.openings ?? [],
    (opening) => openingSeed(opening, floorRef, roomRef),
  ).map((opening) => openingSeed(opening, floorRef, roomRef));
  const normalizedFurniture = sortByCanonical(project.scene.furniture, (row) => ({
    room: roomRef(row.roomId),
    kind: row.kind,
    x: round(row.x),
    z: round(row.z),
    rotation: round(row.rotation),
    color: row.color.toLowerCase(),
    origin: row.origin,
  })).map((row) => ({
    room: roomRef(row.roomId),
    kind: row.kind,
    x: round(row.x),
    z: round(row.z),
    rotation: round(row.rotation),
    color: row.color.toLowerCase(),
    origin: row.origin,
  }));
  const normalizedSite = sortByCanonical(project.scene.siteElements ?? [], (row) =>
    siteSeed(row, floorRef, assetRef),
  ).map((row) => siteSeed(row, floorRef, assetRef));

  const normalized = {
    normalization: "scene-v1",
    model: assetRef(project.scene.modelId),
    publishModel: assetRef(project.scene.publishModelId ?? project.scene.modelId),
    scale: round(project.scene.scale),
    modelTransform: project.scene.modelTransform
      ? {
          x: round(project.scene.modelTransform.x),
          y: round(project.scene.modelTransform.y),
          z: round(project.scene.modelTransform.z),
          rotationY: round(project.scene.modelTransform.rotationY),
        }
      : undefined,
    appearance: project.scene.appearance
      ? {
          exposure: round(project.scene.appearance.exposure),
          sunIntensity: round(project.scene.appearance.sunIntensity),
          hemisphereIntensity: round(project.scene.appearance.hemisphereIntensity),
          background: project.scene.appearance.background.toLowerCase(),
          referenceVisual: project.scene.appearance.referenceVisual,
          nightMode: project.scene.appearance.nightMode,
        }
      : undefined,
    materialOverrides: sortByCanonical(project.scene.materialOverrides ?? [], (row) => ({
      ...row,
      baseColor: row.baseColor?.toLowerCase(),
      emissive: row.emissive?.toLowerCase(),
    })),
    referenceLayers: sortByCanonical(project.scene.referenceLayers ?? [], (row) => ({
      source: assetRef(row.assetId),
      visible: row.visible,
      opacity: round(row.opacity),
      metresPerPixel:
        row.metresPerPixel === undefined ? undefined : round(row.metresPerPixel),
      x: round(row.x),
      y: round(row.y),
      z: round(row.z),
      rotation: round(row.rotation),
    })).map((row) => ({
      source: assetRef(row.assetId),
      visible: row.visible,
      opacity: round(row.opacity),
      metresPerPixel:
        row.metresPerPixel === undefined ? undefined : round(row.metresPerPixel),
      x: round(row.x),
      y: round(row.y),
      z: round(row.z),
      rotation: round(row.rotation),
    })),
    referenceImageEvidence: project.scene.referenceImageEvidence
      ? referenceEvidenceSeed(project.scene.referenceImageEvidence, assetRef)
      : undefined,
    referenceImageEvidenceSet: sortByCanonical(
      project.scene.referenceImageEvidenceSet ?? [],
      (evidence) => referenceEvidenceSeed(evidence, assetRef),
    ).map((evidence) => referenceEvidenceSeed(evidence, assetRef)),
    floors: normalizedFloors,
    rooms: normalizedRooms,
    walls: normalizedWalls,
    openings: normalizedOpenings,
    furniture: normalizedFurniture,
    siteElements: normalizedSite,
    modelNodeTags: sortByCanonical(project.scene.modelNodeTags ?? [], (tag) => ({
      nodeName: tag.nodeName,
      occurrence: tag.occurrence,
      floor: tag.floorId ? floorRef(tag.floorId) : undefined,
      unit: tag.unit,
      room: tag.roomId ? roomRef(tag.roomId) : undefined,
      assignment: tag.assignment,
      confidence: tag.confidence === undefined ? undefined : round(tag.confidence),
      semantic: tag.semantic,
      semanticAssignment: tag.semanticAssignment,
      semanticConfidence:
        tag.semanticConfidence === undefined ? undefined : round(tag.semanticConfidence),
    })).map((tag) => ({
      nodeName: tag.nodeName,
      occurrence: tag.occurrence,
      floor: tag.floorId ? floorRef(tag.floorId) : undefined,
      unit: tag.unit,
      room: tag.roomId ? roomRef(tag.roomId) : undefined,
      assignment: tag.assignment,
      confidence: tag.confidence === undefined ? undefined : round(tag.confidence),
      semantic: tag.semantic,
      semanticAssignment: tag.semanticAssignment,
      semanticConfidence:
        tag.semanticConfidence === undefined ? undefined : round(tag.semanticConfidence),
    })),
  };

  return {
    schema: 1,
    kind: "rekixo-normalized-scene-fingerprint",
    algorithm: "sha256",
    normalization: "scene-v1",
    hash: await sha256(stableStringify(normalized)),
    entityCounts: {
      floors: normalizedFloors.length,
      rooms: normalizedRooms.length,
      walls: normalizedWalls.length,
      openings: normalizedOpenings.length,
      furniture: normalizedFurniture.length,
      siteElements: normalizedSite.length,
      referenceLayers: project.scene.referenceLayers?.length ?? 0,
      modelNodeTags: project.scene.modelNodeTags?.length ?? 0,
    },
  };
}

/** A replay is certified only by comparing two or more independently produced fingerprints. */
export function certifyDeterministicReplay(
  fingerprints: readonly NormalizedSceneFingerprint[],
): DeterministicReplayCertification {
  if (fingerprints.length < 2)
    return {
      state: "pending",
      runs: fingerprints.length,
      normalization: "scene-v1",
      hash: fingerprints[0]?.hash,
      mismatchedHashes: [],
      detail:
        "A normalized scene fingerprint exists, but deterministic replay needs at least two independent AutoBuild runs.",
    };

  const expected = fingerprints[0].hash;
  const mismatchedHashes = [
    ...new Set(fingerprints.slice(1).map((row) => row.hash).filter((hash) => hash !== expected)),
  ];
  return mismatchedHashes.length
    ? {
        state: "blocked",
        runs: fingerprints.length,
        normalization: "scene-v1",
        hash: expected,
        mismatchedHashes,
        detail:
          "Independent AutoBuild runs produced different normalized scene fingerprints.",
      }
    : {
        state: "passed",
        runs: fingerprints.length,
        normalization: "scene-v1",
        hash: expected,
        mismatchedHashes: [],
        detail: `${fingerprints.length} independent AutoBuild runs produced the same normalized scene fingerprint.`,
      };
}

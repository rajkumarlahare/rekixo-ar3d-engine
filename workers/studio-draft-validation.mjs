const FURNITURE = {
  sofa: { width: 2.1, depth: 0.85 },
  bed: { width: 1.6, depth: 2 },
  table: { width: 1.1, depth: 0.65 },
  wardrobe: { width: 1.5, depth: 0.6 },
  plant: { width: 0.45, depth: 0.45 },
};

const text = (value, max = 200) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const number = (value, min, max) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
const color = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const uniqueIds = (items, max = 100) =>
  Array.isArray(items) &&
  items.length <= max &&
  new Set(items.map((item) => item?.id)).size === items.length &&
  items.every((item) => item && text(item.id, 100));

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return area / 2;
}

function pointOnSegment(point, left, right, epsilon = 1e-7) {
  const cross =
    (point[0] - left[0]) * (right[1] - left[1]) -
    (point[1] - left[1]) * (right[0] - left[0]);
  if (Math.abs(cross) > epsilon) return false;
  return (
    point[0] >= Math.min(left[0], right[0]) - epsilon &&
    point[0] <= Math.max(left[0], right[0]) + epsilon &&
    point[1] >= Math.min(left[1], right[1]) - epsilon &&
    point[1] <= Math.max(left[1], right[1]) + epsilon
  );
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a, b, c, d) {
  const epsilon = 1e-8;
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
  if (Math.abs(abC) <= epsilon && pointOnSegment(c, a, b)) return true;
  if (Math.abs(abD) <= epsilon && pointOnSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= epsilon && pointOnSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= epsilon && pointOnSegment(b, c, d)) return true;
  return false;
}

function validPolygon(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 64)
    return false;
  if (
    points.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        Math.abs(point[0]) > 10000 ||
        Math.abs(point[1]) > 10000,
    )
  )
    return false;
  if (Math.abs(polygonArea(points)) < 0.25) return false;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    if (
      Math.hypot(
        points[index][0] - points[next][0],
        points[index][1] - points[next][1],
      ) < 0.05
    )
      return false;
  }
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length;
      if (
        left === right ||
        leftNext === right ||
        rightNext === left ||
        (left === 0 && rightNext === 0)
      )
        continue;
      if (segmentsCross(points[left], points[leftNext], points[right], points[rightNext]))
        return false;
    }
  }
  return true;
}

function polygonBounds(points) {
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minZ = Math.min(...points.map((point) => point[1]));
  const maxZ = Math.max(...points.map((point) => point[1]));
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

function roomBoundary(room) {
  if (Array.isArray(room.polygon) && room.polygon.length) return room.polygon;
  return [
    [room.x - room.width / 2, room.z - room.depth / 2],
    [room.x + room.width / 2, room.z - room.depth / 2],
    [room.x + room.width / 2, room.z + room.depth / 2],
    [room.x - room.width / 2, room.z + room.depth / 2],
  ];
}

function pointInRoom(room, x, z) {
  const points = roomBoundary(room);
  let inside = false;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index++
  ) {
    const left = points[index];
    const right = points[previous];
    if (pointOnSegment([x, z], left, right)) return true;
    const crosses =
      (left[1] > z) !== (right[1] > z) &&
      x <
        ((right[0] - left[0]) * (z - left[1])) /
          (right[1] - left[1]) +
          left[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function furnitureFits(room, item) {
  const definition = FURNITURE[item.kind];
  const angle = (item.rotation * Math.PI) / 180;
  const corners = [
    [-definition.width / 2, -definition.depth / 2],
    [definition.width / 2, -definition.depth / 2],
    [definition.width / 2, definition.depth / 2],
    [-definition.width / 2, definition.depth / 2],
  ].map(([localX, localZ]) => [
    room.x +
      item.x +
      localX * Math.cos(angle) -
      localZ * Math.sin(angle),
    room.z +
      item.z +
      localX * Math.sin(angle) +
      localZ * Math.cos(angle),
  ]);
  return corners.every(([x, z]) => pointInRoom(room, x, z));
}

function validateScene(scene, assetIds) {
  if (
    !scene ||
    typeof scene !== "object" ||
    Array.isArray(scene) ||
    !uniqueIds(scene.floors, 100) ||
    !scene.floors.length ||
    !uniqueIds(scene.rooms ?? [], 500) ||
    !uniqueIds(scene.furniture ?? [], 2000) ||
    (scene.walls !== undefined && !uniqueIds(scene.walls, 10000)) ||
    (scene.openings !== undefined && !uniqueIds(scene.openings, 5000)) ||
    !number(scene.scale, 0.0001, 10000)
  )
    throw Error("Invalid Studio scene or scene limits exceeded.");

  if (scene.modelId !== undefined && !assetIds.has(scene.modelId))
    throw Error("Studio scene model asset is missing.");
  if (
    scene.publishModelId !== undefined &&
    !assetIds.has(scene.publishModelId)
  )
    throw Error("Studio scene publish model asset is missing.");

  if (scene.referenceImageEvidence !== undefined) {
    const evidence = scene.referenceImageEvidence;
    if (
      !evidence ||
      typeof evidence !== "object" ||
      Array.isArray(evidence) ||
      !assetIds.has(evidence.assetId) ||
      !Number.isInteger(evidence.sourceWidth) ||
      !number(evidence.sourceWidth, 2, 50000) ||
      !Number.isInteger(evidence.sourceHeight) ||
      !number(evidence.sourceHeight, 2, 50000) ||
      !Number.isInteger(evidence.sampledWidth) ||
      !number(evidence.sampledWidth, 2, 2000) ||
      !Number.isInteger(evidence.sampledHeight) ||
      !number(evidence.sampledHeight, 2, 2000) ||
      !Array.isArray(evidence.renderedPalette) ||
      evidence.renderedPalette.length < 1 ||
      evidence.renderedPalette.length > 8 ||
      evidence.renderedPalette.some((entry) => !color(entry)) ||
      new Set(
        evidence.renderedPalette.map((entry) => String(entry).toLowerCase()),
      ).size !== evidence.renderedPalette.length ||
      !number(evidence.averageLuminance, 0, 1) ||
      !number(evidence.warmFraction, 0, 1) ||
      !number(evidence.darkFraction, 0, 1) ||
      !number(evidence.highlightFraction, 0, 1) ||
      !number(evidence.averageSaturation, 0, 1) ||
      !number(evidence.verticalEdgeStrength, 0, 1) ||
      !number(evidence.horizontalEdgeStrength, 0, 1) ||
      !["day", "evening", "night", "unknown"].includes(
        evidence.lightingMood,
      ) ||
      !number(evidence.confidence, 0, 1) ||
      !Number.isInteger(evidence.sampleCount) ||
      !number(evidence.sampleCount, 1, 1000000)
    )
      throw Error("Invalid Studio reference image evidence.");
  }

  for (const floor of scene.floors)
    if (
      !text(floor.name) ||
      !number(floor.elevation, -500, 2000) ||
      (floor.repeatOfFloorId !== undefined &&
        (!text(floor.repeatOfFloorId, 100) ||
          floor.repeatOfFloorId === floor.id ||
          !scene.floors.some((candidate) => candidate.id === floor.repeatOfFloorId))) ||
      (floor.repeatConfidence !== undefined &&
        !number(floor.repeatConfidence, 0, 1)) ||
      (floor.repeatReviewed !== undefined &&
        typeof floor.repeatReviewed !== "boolean") ||
      (floor.repeatReviewState !== undefined &&
        !["suggested", "auto_ready", "human_reviewed"].includes(
          floor.repeatReviewState,
        )) ||
      (floor.repeatReviewState === "human_reviewed" &&
        floor.repeatReviewed !== true) ||
      (floor.repeatReviewed === true &&
        floor.repeatReviewState !== undefined &&
        floor.repeatReviewState !== "human_reviewed")
    )
      throw Error("Invalid Studio floor.");

  const floors = new Map(scene.floors.map((floor) => [floor.id, floor]));
  const rooms = new Map();
  for (const room of scene.rooms ?? []) {
    if (
      !text(room.name) ||
      !text(room.unit) ||
      !floors.has(room.floorId) ||
      !number(room.x, -10000, 10000) ||
      !number(room.z, -10000, 10000) ||
      !number(room.width, 0.5, 200) ||
      !number(room.depth, 0.5, 200) ||
      !number(room.height, 1.8, 20) ||
      !color(room.color) ||
      typeof room.source !== "string" ||
      room.source.length > 2000 ||
      typeof room.verified !== "boolean" ||
      (room.verified &&
        !room.source.trim() &&
        !room.sourceAssetId &&
        !room.sourcePackSourceId) ||
      (room.sourceAssetId !== undefined && !assetIds.has(room.sourceAssetId)) ||
      (room.sourcePackSourceId !== undefined && !text(room.sourcePackSourceId, 200)) ||
      (room.sourceClaimIds !== undefined &&
        (!Array.isArray(room.sourceClaimIds) ||
          room.sourceClaimIds.length > 100 ||
          new Set(room.sourceClaimIds).size !== room.sourceClaimIds.length ||
          room.sourceClaimIds.some((claim) => !text(claim, 200)))) ||
      (room.sourceClaimIds?.length && !room.sourcePackSourceId) ||
      (room.mesh !== undefined && !text(room.mesh, 500))
    )
      throw Error("Invalid Studio room.");

    if (room.polygon !== undefined) {
      if (!validPolygon(room.polygon))
        throw Error("Invalid Studio room polygon.");
      const bounds = polygonBounds(room.polygon);
      if (
        Math.abs(bounds.x - room.x) > 0.002 ||
        Math.abs(bounds.z - room.z) > 0.002 ||
        Math.abs(bounds.width - room.width) > 0.002 ||
        Math.abs(bounds.depth - room.depth) > 0.002
      )
        throw Error("Studio room polygon bounds do not match room geometry.");
    }
    rooms.set(room.id, room);
  }

  for (const item of scene.furniture ?? []) {
    const room = rooms.get(item.roomId);
    if (
      !Object.hasOwn(FURNITURE, item.kind) ||
      !room ||
      !number(item.rotation, -360, 360) ||
      !number(item.x, -200, 200) ||
      !number(item.z, -200, 200) ||
      !color(item.color) ||
      !furnitureFits(room, item)
    )
      throw Error("Invalid Studio furniture placement.");
  }

  for (const wall of scene.walls ?? []) {
    if (
      !floors.has(wall.floorId) ||
      !Array.isArray(wall.roomIds) ||
      wall.roomIds.length > 2 ||
      new Set(wall.roomIds).size !== wall.roomIds.length ||
      wall.roomIds.some((roomId) => {
        const room = rooms.get(roomId);
        return !room || room.floorId !== wall.floorId;
      }) ||
      !Array.isArray(wall.start) ||
      wall.start.length !== 2 ||
      !number(wall.start[0], -10000, 10000) ||
      !number(wall.start[1], -10000, 10000) ||
      !Array.isArray(wall.end) ||
      wall.end.length !== 2 ||
      !number(wall.end[0], -10000, 10000) ||
      !number(wall.end[1], -10000, 10000) ||
      Math.hypot(
        wall.end[0] - wall.start[0],
        wall.end[1] - wall.start[1],
      ) < 0.03 ||
      !number(wall.thickness, 0.03, 5) ||
      !number(wall.height, 0.3, 20) ||
      typeof wall.reviewed !== "boolean" ||
      !["model-auto", "room-derived", "cad-auto", "manual"].includes(wall.origin) ||
      (wall.sourceNodeName !== undefined && !text(wall.sourceNodeName, 500)) ||
      (wall.sourceOccurrence !== undefined &&
        (!Number.isInteger(wall.sourceOccurrence) ||
          wall.sourceOccurrence < 1 ||
          wall.sourceOccurrence > 100000 ||
          !wall.sourceNodeName)) ||
      (wall.confidence !== undefined && !number(wall.confidence, 0, 1)) ||
      (wall.reviewState !== undefined &&
        !["suggested", "auto_ready", "human_reviewed"].includes(
          wall.reviewState,
        )) ||
      (wall.reviewState === "human_reviewed" && wall.reviewed !== true) ||
      (wall.reviewed === true &&
        wall.reviewState !== undefined &&
        wall.reviewState !== "human_reviewed")
    )
      throw Error("Invalid Studio parametric wall.");
  }

  for (const opening of scene.openings ?? []) {
    if (
      !floors.has(opening.floorId) ||
      !["door", "window", "opening"].includes(opening.kind) ||
      !Array.isArray(opening.roomIds) ||
      opening.roomIds.length < 1 ||
      opening.roomIds.length > 2 ||
      new Set(opening.roomIds).size !== opening.roomIds.length ||
      opening.roomIds.some((roomId) => {
        const room = rooms.get(roomId);
        return !room || room.floorId !== opening.floorId;
      }) ||
      !number(opening.x, -10000, 10000) ||
      !number(opening.y, -1000, 5000) ||
      !number(opening.z, -10000, 10000) ||
      !number(opening.width, 0.05, 50) ||
      !number(opening.height, 0.05, 50) ||
      (opening.sillHeight !== undefined && !number(opening.sillHeight, 0, 50)) ||
      !number(opening.rotationY, -3600, 3600) ||
      typeof opening.reviewed !== "boolean" ||
      (opening.sourceNodeName !== undefined && !text(opening.sourceNodeName, 500)) ||
      (opening.sourceOccurrence !== undefined &&
        (!Number.isInteger(opening.sourceOccurrence) ||
          opening.sourceOccurrence < 1 ||
          opening.sourceOccurrence > 100000 ||
          !opening.sourceNodeName)) ||
      (opening.confidence !== undefined && !number(opening.confidence, 0, 1)) ||
      (opening.reviewState !== undefined &&
        !["suggested", "auto_ready", "human_reviewed"].includes(
          opening.reviewState,
        )) ||
      (opening.reviewState === "human_reviewed" &&
        opening.reviewed !== true) ||
      (opening.reviewed === true &&
        opening.reviewState !== undefined &&
        opening.reviewState !== "human_reviewed")
    )
      throw Error("Invalid Studio opening.");
  }

  if (scene.referenceLayers !== undefined) {
    if (!uniqueIds(scene.referenceLayers, 100))
      throw Error("Invalid Studio reference layers.");
    for (const layer of scene.referenceLayers) {
      if (
        !assetIds.has(layer.assetId) ||
        typeof layer.visible !== "boolean" ||
        !number(layer.opacity, 0.02, 1) ||
        (layer.metresPerPixel !== undefined &&
          !number(layer.metresPerPixel, 0.0000001, 1000)) ||
        !number(layer.x, -1000000, 1000000) ||
        !number(layer.y, -10000, 100000) ||
        !number(layer.z, -1000000, 1000000) ||
        !number(layer.rotation, -3600, 3600)
      )
        throw Error("Invalid Studio reference layer.");
    }
  }

  if (scene.modelNodeTags !== undefined) {
    if (
      !Array.isArray(scene.modelNodeTags) ||
      scene.modelNodeTags.length > 5000 ||
      new Set(
        scene.modelNodeTags.map(
          (tag) => `${tag?.nodeName}\u0000${tag?.occurrence}`,
        ),
      ).size !== scene.modelNodeTags.length
    )
      throw Error("Invalid Studio model-node tags.");
    for (const tag of scene.modelNodeTags) {
      const room = tag.roomId ? rooms.get(tag.roomId) : undefined;
      if (
        !text(tag.nodeName, 500) ||
        !Number.isInteger(tag.occurrence) ||
        tag.occurrence < 1 ||
        tag.occurrence > 100000 ||
        (tag.floorId !== undefined && !floors.has(tag.floorId)) ||
        (tag.unit !== undefined &&
          (typeof tag.unit !== "string" || tag.unit.length > 120)) ||
        (tag.assignment !== undefined && !["auto", "manual"].includes(tag.assignment)) ||
        (tag.confidence !== undefined && !number(tag.confidence, 0, 1)) ||
        (tag.semantic !== undefined &&
          !["wall", "door", "window", "opening", "ignore"].includes(tag.semantic)) ||
        (tag.semanticAssignment !== undefined &&
          !["auto", "manual"].includes(tag.semanticAssignment)) ||
        (tag.semanticConfidence !== undefined &&
          !number(tag.semanticConfidence, 0, 1)) ||
        (tag.roomId !== undefined && !room) ||
        (room && tag.floorId !== undefined && room.floorId !== tag.floorId) ||
        (room &&
          tag.unit !== undefined &&
          tag.unit.trim() &&
          room.unit !== tag.unit.trim())
      )
        throw Error("Invalid Studio model-node tag.");
    }
  }

  if (scene.appearance !== undefined) {
    const appearance = scene.appearance;
    if (
      !appearance ||
      !number(appearance.exposure, 0.1, 4) ||
      !number(appearance.sunIntensity, 0, 30) ||
      !number(appearance.hemisphereIntensity, 0, 30) ||
      !color(appearance.background) ||
      typeof appearance.referenceVisual !== "boolean" ||
      typeof appearance.nightMode !== "boolean"
    )
      throw Error("Invalid Studio appearance settings.");
  }

  if (scene.materialOverrides !== undefined) {
    if (
      !Array.isArray(scene.materialOverrides) ||
      scene.materialOverrides.length > 250 ||
      new Set(scene.materialOverrides.map((item) => item?.materialName)).size !==
        scene.materialOverrides.length
    )
      throw Error("Invalid Studio material overrides.");
    for (const material of scene.materialOverrides) {
      if (
        !text(material.materialName, 300) ||
        (material.baseColor !== undefined && !color(material.baseColor)) ||
        (material.roughness !== undefined && !number(material.roughness, 0, 1)) ||
        (material.metalness !== undefined && !number(material.metalness, 0, 1)) ||
        (material.opacity !== undefined && !number(material.opacity, 0.02, 1)) ||
        (material.emissive !== undefined && !color(material.emissive)) ||
        (material.emissiveIntensity !== undefined &&
          !number(material.emissiveIntensity, 0, 20))
      )
        throw Error("Invalid Studio material override.");
    }
  }

  if (scene.modelTransform !== undefined) {
    const transform = scene.modelTransform;
    if (
      !transform ||
      !number(transform.x, -10000, 10000) ||
      !number(transform.y, -10000, 10000) ||
      !number(transform.z, -10000, 10000) ||
      !number(transform.rotationY, -3600, 3600)
    )
      throw Error("Invalid Studio model transform.");
  }
}

export function validateStudioDraft(draft, project) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft))
    throw Error("Cloud draft must be an object.");
  if (draft.schema !== 1)
    throw Error("Unsupported Studio draft schema.");
  if (draft.id !== project.id || draft.slug !== project.slug)
    throw Error("Cloud draft project identity mismatch.");
  if (!text(draft.name, 200))
    throw Error("Cloud draft project name is invalid.");
  if (!text(draft.updated, 100))
    throw Error("Cloud draft update timestamp is invalid.");
  if (
    draft.location !== undefined &&
    (typeof draft.location !== "string" || draft.location.length > 180)
  )
    throw Error("Cloud draft location is invalid.");
  if (
    draft.referenceUrl !== undefined &&
    (typeof draft.referenceUrl !== "string" ||
      draft.referenceUrl.length > 1000 ||
      (draft.referenceUrl.trim() && !/^https?:\/\//i.test(draft.referenceUrl.trim())))
  )
    throw Error("Cloud draft reference URL is invalid.");
  if (
    draft.brief !== undefined &&
    (typeof draft.brief !== "string" || draft.brief.length > 5000)
  )
    throw Error("Cloud draft brief is invalid.");
  if (
    !Array.isArray(draft.assets) ||
    draft.assets.length > 100 ||
    new Set(draft.assets).size !== draft.assets.length ||
    draft.assets.some((assetId) => !text(assetId, 100))
  )
    throw Error("Cloud draft asset list is invalid.");

  const assetIds = new Set(draft.assets);
  validateScene(draft.scene, assetIds);

  if (
    !Array.isArray(draft.releases) ||
    draft.releases.length > 30 ||
    new Set(draft.releases.map((release) => release?.id)).size !== draft.releases.length
  )
    throw Error("Cloud draft review versions are invalid.");
  for (const release of draft.releases) {
    if (
      !release ||
      !text(release.id, 100) ||
      !text(release.name, 200) ||
      !text(release.date, 100)
    )
      throw Error("Cloud draft review version is invalid.");
    validateScene(release.scene, assetIds);
  }

  return draft.assets;
}

function publicFloor(floor) {
  return {
    id: floor.id,
    name: floor.name,
    elevation: floor.elevation,
    ...(floor.repeatReviewed === true && floor.repeatOfFloorId
      ? {
          repeatOfFloorId: floor.repeatOfFloorId,
          ...(floor.repeatConfidence !== undefined
            ? { repeatConfidence: floor.repeatConfidence }
            : {}),
          repeatReviewed: true,
        }
      : {}),
  };
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    unit: room.unit,
    floorId: room.floorId,
    x: room.x,
    z: room.z,
    width: room.width,
    depth: room.depth,
    ...(room.polygon ? { polygon: structuredClone(room.polygon) } : {}),
    height: room.height,
    color: room.color,
    source: room.verified ? "Published reviewed geometry." : "",
    verified: room.verified,
  };
}

function publicWall(wall) {
  return {
    id: wall.id,
    floorId: wall.floorId,
    roomIds: [...wall.roomIds],
    start: [...wall.start],
    end: [...wall.end],
    thickness: wall.thickness,
    height: wall.height,
    reviewed: wall.reviewed,
    origin: wall.origin,
    ...(wall.confidence !== undefined ? { confidence: wall.confidence } : {}),
  };
}

function publicOpening(opening) {
  return {
    id: opening.id,
    floorId: opening.floorId,
    kind: opening.kind,
    roomIds: [...opening.roomIds],
    x: opening.x,
    y: opening.y,
    z: opening.z,
    width: opening.width,
    height: opening.height,
    ...(opening.sillHeight !== undefined
      ? { sillHeight: opening.sillHeight }
      : {}),
    rotationY: opening.rotationY,
    reviewed: true,
  };
}

export function publicStudioSnapshot(draft) {
  const scene = draft.scene;
  const requestedModelId =
    typeof scene?.publishModelId === "string"
      ? scene.publishModelId
      : scene?.modelId;
  const modelId =
    typeof requestedModelId === "string" &&
    draft.assets.includes(requestedModelId)
      ? requestedModelId
      : undefined;

  return {
    schema: 1,
    id: draft.id,
    name: draft.name,
    slug: draft.slug,
    ...(draft.location ? { location: draft.location } : {}),
    updated: draft.updated,
    assets: modelId ? [modelId] : [],
    releases: [],
    scene: {
      scale: scene.scale,
      ...(modelId ? { modelId } : {}),
      ...(scene.appearance
        ? { appearance: structuredClone(scene.appearance) }
        : {}),
      ...(scene.materialOverrides
        ? { materialOverrides: structuredClone(scene.materialOverrides) }
        : {}),
      ...(scene.modelTransform
        ? { modelTransform: structuredClone(scene.modelTransform) }
        : {}),
      referenceLayers: [],
      modelNodeTags: [],
      floors: (scene.floors ?? []).map(publicFloor),
      rooms: (scene.rooms ?? []).map(publicRoom),
      furniture: structuredClone(scene.furniture ?? []),
      walls: (scene.walls ?? [])
        .filter((wall) => wall?.reviewed === true)
        .map(publicWall),
      openings: (scene.openings ?? [])
        .filter((opening) => opening?.reviewed === true)
        .map(publicOpening),
    },
  };
}

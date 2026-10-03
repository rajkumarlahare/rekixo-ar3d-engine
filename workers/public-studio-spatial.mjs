const PUBLIC_SITE_KINDS = new Set([
  "garden",
  "lawn",
  "path",
  "road",
  "parking",
  "tree",
  "plant",
  "gate",
  "outdoor-light",
]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function spatialTransform(scene) {
  const scale =
    typeof scene.scale === "number" &&
    Number.isFinite(scene.scale) &&
    scene.scale > 0
      ? scene.scale
      : 1;
  const transform =
    scene.modelTransform && typeof scene.modelTransform === "object"
      ? scene.modelTransform
      : {};
  const tx = Number.isFinite(transform.x) ? Number(transform.x) : 0;
  const ty = Number.isFinite(transform.y) ? Number(transform.y) : 0;
  const tz = Number.isFinite(transform.z) ? Number(transform.z) : 0;
  const rotationY = Number.isFinite(transform.rotationY)
    ? Number(transform.rotationY)
    : 0;
  const angle = (rotationY * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  const toModelXZ = (x, z) => {
    const dx = (Number(x) - tx) / scale;
    const dz = (Number(z) - tz) / scale;
    return [
      dx * cosine - dz * sine,
      dx * sine + dz * cosine,
    ];
  };
  const toModelY = (y) => (Number(y) - ty) / scale;
  const toModelRotation = (degrees) => {
    const tangentX = Math.cos((Number(degrees) * Math.PI) / 180);
    const tangentZ = -Math.sin((Number(degrees) * Math.PI) / 180);
    const localTangentX = tangentX * cosine - tangentZ * sine;
    const localTangentZ = tangentX * sine + tangentZ * cosine;
    return (Math.atan2(-localTangentZ, localTangentX) * 180) / Math.PI;
  };

  return { scale, toModelXZ, toModelY, toModelRotation };
}

function publicSiteElements(scene, spatial) {
  const result = [];
  const ids = new Set();
  for (const site of Array.isArray(scene.siteElements) ? scene.siteElements : []) {
    if (
      !site ||
      site.reviewed !== true ||
      typeof site.id !== "string" ||
      !site.id ||
      ids.has(site.id) ||
      !PUBLIC_SITE_KINDS.has(site.kind) ||
      ![
        site.x,
        site.z,
        site.width,
        site.depth,
        site.height,
        site.rotation,
      ].every(finite) ||
      site.width <= 0 ||
      site.depth <= 0 ||
      site.height <= 0 ||
      !validColor(site.color)
    )
      continue;

    const [x, z] = spatial.toModelXZ(site.x, site.z);
    result.push({
      id: site.id,
      kind: site.kind,
      x,
      y: spatial.toModelY(0),
      z,
      width: site.width / spatial.scale,
      depth: site.depth / spatial.scale,
      height: site.height / spatial.scale,
      rotation: spatial.toModelRotation(site.rotation),
      color: site.color.toLowerCase(),
    });
    ids.add(site.id);
  }
  return result;
}

export function publicWalkthroughFromStudio(manifest) {
  const scene = manifest.studio?.project?.scene;
  if (!scene || typeof scene !== "object") return undefined;

  const spatial = spatialTransform(scene);
  const floorById = new Map(
    (Array.isArray(scene.floors) ? scene.floors : [])
      .filter(
        (floor) =>
          floor &&
          typeof floor.id === "string" &&
          typeof floor.elevation === "number" &&
          Number.isFinite(floor.elevation),
      )
      .map((floor) => [floor.id, floor]),
  );

  const rooms = [];
  const roomIds = new Set();
  for (const room of Array.isArray(scene.rooms) ? scene.rooms : []) {
    if (
      !room ||
      typeof room.id !== "string" ||
      typeof room.floorId !== "string" ||
      typeof room.name !== "string" ||
      typeof room.unit !== "string"
    )
      continue;
    const floor = floorById.get(room.floorId);
    if (!floor) continue;

    let boundary;
    if (
      Array.isArray(room.polygon) &&
      room.polygon.length >= 3 &&
      room.polygon.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every(finite),
      )
    ) {
      boundary = room.polygon.map(([x, z]) => spatial.toModelXZ(x, z));
    } else if (
      [room.x, room.z, room.width, room.depth].every(finite) &&
      room.width > 0 &&
      room.depth > 0
    ) {
      boundary = [
        [room.x - room.width / 2, room.z - room.depth / 2],
        [room.x + room.width / 2, room.z - room.depth / 2],
        [room.x + room.width / 2, room.z + room.depth / 2],
        [room.x - room.width / 2, room.z + room.depth / 2],
      ].map(([x, z]) => spatial.toModelXZ(x, z));
    } else {
      continue;
    }

    const height =
      typeof room.height === "number" &&
      Number.isFinite(room.height) &&
      room.height > 0
        ? room.height / spatial.scale
        : 2.8 / spatial.scale;
    rooms.push({
      id: room.id,
      floorId: room.floorId,
      name: room.name,
      unit: room.unit,
      elevation: spatial.toModelY(floor.elevation),
      height,
      boundary,
    });
    roomIds.add(room.id);
  }

  const doors = [];
  const doorIds = new Set();
  for (const opening of Array.isArray(scene.openings) ? scene.openings : []) {
    if (
      !opening ||
      opening.reviewed !== true ||
      opening.kind !== "door" ||
      typeof opening.id !== "string" ||
      doorIds.has(opening.id) ||
      !Array.isArray(opening.roomIds) ||
      opening.roomIds.length !== 2 ||
      opening.roomIds[0] === opening.roomIds[1] ||
      !opening.roomIds.every((roomId) => roomIds.has(roomId)) ||
      typeof opening.floorId !== "string" ||
      ![
        opening.x,
        opening.y,
        opening.z,
        opening.width,
        opening.height,
        opening.rotationY,
      ].every(finite) ||
      opening.width <= 0 ||
      opening.height <= 0
    )
      continue;
    const [x, z] = spatial.toModelXZ(opening.x, opening.z);
    doors.push({
      id: opening.id,
      floorId: opening.floorId,
      roomIds: [opening.roomIds[0], opening.roomIds[1]],
      x,
      y: spatial.toModelY(opening.y),
      z,
      width: opening.width / spatial.scale,
      height: opening.height / spatial.scale,
      rotationY: spatial.toModelRotation(opening.rotationY),
    });
    doorIds.add(opening.id);
  }

  const siteElements = publicSiteElements(scene, spatial);
  if (!rooms.length && !siteElements.length) return undefined;

  return {
    version: 1,
    metresPerUnit: spatial.scale,
    rooms,
    doors,
    ...(siteElements.length ? { siteElements } : {}),
  };
}

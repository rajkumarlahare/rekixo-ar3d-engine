const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown, max = 1000) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

const id = (value: unknown) =>
  text(value, 180) && /^[A-Za-z0-9_.-]+$/.test(value as string);

const slug = (value: unknown) =>
  text(value, 80) &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value as string);

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);

function engineRuntimeUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value.startsWith("/3Dprojects/")) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname.startsWith("/3Dprojects/")
    );
  } catch {
    return false;
  }
}

function assertProject(value: unknown) {
  if (!isObject(value))
    throw Error("Invalid project payload.");
  if (
    !id(value.id) ||
    !slug(value.slug) ||
    !text(value.name, 300) ||
    !["draft", "published", "archived"].includes(String(value.status)) ||
    (value.location !== undefined && !text(value.location, 500)) ||
    (value.coverAssetKey !== undefined &&
      (typeof value.coverAssetKey !== "string" ||
        value.coverAssetKey.length > 1000))
  )
    throw Error("Invalid project payload.");
}

function assertModel(value: unknown) {
  if (!isObject(value))
    throw Error("Invalid model payload.");
  if (
    !id(value.id) ||
    !id(value.projectId) ||
    !text(value.name, 300) ||
    !Number.isInteger(value.version) ||
    Number(value.version) < 1 ||
    !text(value.mimeType, 200) ||
    typeof value.available !== "boolean" ||
    (value.byteSize !== undefined &&
      (!Number.isSafeInteger(value.byteSize) || Number(value.byteSize) < 0)) ||
    (value.sourceFilename !== undefined &&
      (typeof value.sourceFilename !== "string" ||
        value.sourceFilename.length > 1000)) ||
    (value.url !== undefined && !engineRuntimeUrl(value.url))
  )
    throw Error("Invalid model payload.");
}

function assertScene(value: unknown) {
  if (!isObject(value))
    throw Error("Invalid scene payload.");
  if (
    !id(value.id) ||
    !id(value.projectId) ||
    !text(value.name, 300) ||
    ![
      "project-navigation",
      "section",
      "wing-distance",
      "balcony",
      "typical-floor",
      "amenity",
    ].includes(String(value.type)) ||
    !Number.isInteger(value.sortOrder) ||
    typeof value.enabled !== "boolean" ||
    (value.modelId !== undefined && !id(value.modelId)) ||
    (value.cameraPresetId !== undefined && !id(value.cameraPresetId)) ||
    (value.settings !== undefined && !isObject(value.settings))
  )
    throw Error("Invalid scene payload.");
}

function assertCamera(value: unknown) {
  if (!isObject(value))
    throw Error("Invalid camera payload.");
  const vector = (item: unknown) =>
    Array.isArray(item) &&
    item.length === 3 &&
    item.every((number) => finiteNumber(number));
  if (
    !id(value.id) ||
    !id(value.projectId) ||
    !text(value.name, 300) ||
    !vector(value.position) ||
    !vector(value.target) ||
    (value.fov !== undefined &&
      (!finiteNumber(value.fov) || Number(value.fov) <= 0 || Number(value.fov) > 180))
  )
    throw Error("Invalid camera payload.");
}

function assertWalkthrough(value: unknown) {
  if (!isObject(value) || value.version !== 1)
    throw Error("Invalid walkthrough graph.");
  if (
    !finiteNumber(value.metresPerUnit) ||
    Number(value.metresPerUnit) <= 0 ||
    Number(value.metresPerUnit) > 10000 ||
    !Array.isArray(value.rooms) ||
    value.rooms.length > 25000 ||
    !Array.isArray(value.doors) ||
    value.doors.length > 50000
  )
    throw Error("Invalid walkthrough graph.");

  const roomIds = new Set<string>();
  for (const room of value.rooms) {
    if (
      !isObject(room) ||
      !id(room.id) ||
      !id(room.floorId) ||
      !text(room.name, 300) ||
      !text(room.unit, 300) ||
      !finiteNumber(room.elevation) ||
      !finiteNumber(room.height) ||
      Number(room.height) <= 0 ||
      !Array.isArray(room.boundary) ||
      room.boundary.length < 3 ||
      room.boundary.length > 64 ||
      room.boundary.some(
        (point) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some((number) => !finiteNumber(number)),
      ) ||
      roomIds.has(String(room.id))
    )
      throw Error("Invalid walkthrough room.");
    roomIds.add(String(room.id));
  }

  const doorIds = new Set<string>();
  for (const door of value.doors) {
    if (
      !isObject(door) ||
      !id(door.id) ||
      !id(door.floorId) ||
      !Array.isArray(door.roomIds) ||
      door.roomIds.length !== 2 ||
      door.roomIds.some(
        (roomId) =>
          !id(roomId) || !roomIds.has(String(roomId)),
      ) ||
      door.roomIds[0] === door.roomIds[1] ||
      !finiteNumber(door.x) ||
      !finiteNumber(door.y) ||
      !finiteNumber(door.z) ||
      !finiteNumber(door.width) ||
      Number(door.width) <= 0 ||
      !finiteNumber(door.height) ||
      Number(door.height) <= 0 ||
      !finiteNumber(door.rotationY) ||
      doorIds.has(String(door.id))
    )
      throw Error("Invalid walkthrough door.");
    doorIds.add(String(door.id));
  }
}

export function assertPublic3DExperiencePayload(value: unknown): void {
  if (!isObject(value))
    throw Error("3D experience response is not an object.");
  assertProject(value.project);
  if (value.scene !== undefined) assertScene(value.scene);
  if (value.scenes !== undefined) {
    if (!Array.isArray(value.scenes) || value.scenes.length > 5000)
      throw Error("Invalid scenes payload.");
    for (const scene of value.scenes) assertScene(scene);
  }
  if (value.camera !== undefined) assertCamera(value.camera);
  if (value.model !== undefined) assertModel(value.model);
  if (value.walkthrough !== undefined) assertWalkthrough(value.walkthrough);
  if (
    value.mediaBaseUrl !== undefined &&
    (typeof value.mediaBaseUrl !== "string" ||
      !value.mediaBaseUrl.startsWith("/3Dprojects/"))
  )
    throw Error("Invalid media base URL.");
}

export function assertAdminProjectsPayload(value: unknown): void {
  if (!isObject(value) || !Array.isArray(value.projects) || value.projects.length > 10000)
    throw Error("Invalid Engine project registry response.");
  for (const project of value.projects) {
    assertProject(project);
    if (!isObject(project)) throw Error("Invalid Engine project summary.");
    for (const field of ["modelCount", "sceneCount", "enabledSceneCount"]) {
      const count = project[field];
      if (
        count !== undefined &&
        (!Number.isSafeInteger(count) || Number(count) < 0)
      )
        throw Error("Invalid Engine project summary count.");
    }
  }
}

export function assertAdminStatusPayload(value: unknown): void {
  if (!isObject(value))
    throw Error("Invalid Engine status response.");
  assertProject(value.project);
  if (!Array.isArray(value.scenes) || !Array.isArray(value.models))
    throw Error("Invalid Engine status collections.");
  for (const scene of value.scenes) assertScene(scene);
  for (const model of value.models) assertModel(model);
  if (value.activeModel !== undefined) assertModel(value.activeModel);
  if (
    !isObject(value.storage) ||
    !text(value.storage.bucket, 200) ||
    typeof value.storage.activeModelObjectAvailable !== "boolean"
  )
    throw Error("Invalid Engine storage status.");
  if (value.modelPage !== undefined) {
    if (
      !isObject(value.modelPage) ||
      !Number.isSafeInteger(value.modelPage.limit) ||
      !Number.isSafeInteger(value.modelPage.offset) ||
      !Number.isSafeInteger(value.modelPage.total) ||
      typeof value.modelPage.hasMore !== "boolean"
    )
      throw Error("Invalid Engine model pagination.");
  }
}

export function assertPlatformEngineContractPayload(value: unknown): void {
  if (
    !isObject(value) ||
    value.contractVersion !== 1 ||
    !Number.isSafeInteger(value.enabledSceneCount) ||
    Number(value.enabledSceneCount) < 0 ||
    typeof value.activeModelAvailable !== "boolean"
  )
    throw Error("Invalid Platform ↔ Engine contract response.");
  assertProject(value.project);
}

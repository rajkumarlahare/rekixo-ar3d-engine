const origin = String(
  process.env.REKIXO_PUBLIC_ORIGIN || "https://ar3dstudio.in",
).replace(/\/+$/, "");
const requestedSlug = String(process.env.REKIXO_DEMO_PROJECT_SLUG || "").trim();
const retryCount = Math.max(1, Number(process.env.REKIXO_DEMO_VERIFY_RETRIES || 6));
const retryDelayMs = Math.max(0, Number(process.env.REKIXO_DEMO_VERIFY_DELAY_MS || 1500));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finite = (value) => typeof value === "number" && Number.isFinite(value);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function absoluteUrl(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return new URL(value, `${origin}/`).toString();
}

async function fetchReady(url, options = {}, accepted = [200]) {
  let lastResponse;
  let lastError;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        cache: "no-store",
        ...options,
      });
      lastResponse = response;
      if (accepted.includes(response.status)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retryCount) await sleep(retryDelayMs);
  }
  const suffix = lastResponse ? `HTTP ${lastResponse.status}` : String(lastError || "request failed");
  throw new Error(`Production readiness request failed for ${url}: ${suffix}`);
}

async function getJson(url, accepted = [200]) {
  const response = await fetchReady(
    url,
    { headers: { Accept: "application/json" } },
    accepted,
  );
  const type = response.headers.get("content-type") || "";
  assert(type.toLowerCase().includes("application/json"), `Expected JSON from ${url}, got ${type || "unknown type"}.`);
  return { response, body: await response.json() };
}


function multiplyMatrix4(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1)
      for (let k = 0; k < 4; k += 1)
        out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  return out;
}

function localNodeMatrix(node) {
  if (Array.isArray(node?.matrix) && node.matrix.length === 16 &&
      node.matrix.every(finite)) return node.matrix;
  const [x, y, z, w] = Array.isArray(node?.rotation) ? node.rotation : [0, 0, 0, 1];
  const [sx, sy, sz] = Array.isArray(node?.scale) ? node.scale : [1, 1, 1];
  const [tx, ty, tz] = Array.isArray(node?.translation) ? node.translation : [0, 0, 0];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const divisor = w && w !== 1 ? w : 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / divisor,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / divisor,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / divisor,
  ];
}

function emptyBox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function extendBox(target, point) {
  for (let axis = 0; axis < 3; axis += 1) {
    target.min[axis] = Math.min(target.min[axis], point[axis]);
    target.max[axis] = Math.max(target.max[axis], point[axis]);
  }
}

function mergeBox(target, source) {
  if (!source || !source.min.every(Number.isFinite) || !source.max.every(Number.isFinite)) return;
  extendBox(target, source.min);
  extendBox(target, source.max);
}

function boxSize(box) {
  return box.min.every(Number.isFinite) && box.max.every(Number.isFinite)
    ? box.max.map((value, axis) => value - box.min[axis])
    : [0, 0, 0];
}

async function readGlbJsonDocument(modelUrl) {
  const firstResponse = await fetchReady(
    modelUrl,
    { headers: { Range: "bytes=0-19" } },
    [200, 206],
  );
  const firstBytes = new Uint8Array(await firstResponse.arrayBuffer());
  if (firstBytes.length < 20 ||
      String.fromCharCode(...firstBytes.subarray(0, 4)) !== "glTF") {
    return { format: "not-glb", byteLength: firstBytes.byteLength };
  }
  const header = new DataView(firstBytes.buffer, firstBytes.byteOffset, firstBytes.byteLength);
  const version = header.getUint32(4, true);
  const jsonLength = header.getUint32(12, true);
  const jsonType = header.getUint32(16, true);
  if (version !== 2 || jsonType !== 0x4e4f534a || jsonLength < 2 || jsonLength > 12 * 1024 * 1024)
    return { format: "glb-header-unexpected", version, jsonLength, jsonType };

  let jsonBytes;
  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  if (firstBytes.length >= jsonEnd) {
    jsonBytes = firstBytes.subarray(jsonStart, jsonEnd);
  } else {
    const jsonResponse = await fetchReady(
      modelUrl,
      { headers: { Range: "bytes=" + jsonStart + "-" + (jsonEnd - 1) } },
      [200, 206],
    );
    const rangeBytes = new Uint8Array(await jsonResponse.arrayBuffer());
    jsonBytes = jsonResponse.status === 206
      ? rangeBytes
      : rangeBytes.subarray(jsonStart, jsonEnd);
  }
  const json = JSON.parse(new TextDecoder().decode(jsonBytes).replace(/\0+$/g, "").trim());
  return { format: "glb-v2", json };
}

function inspectGltfGeometry(json) {
  const nodes = Array.isArray(json?.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json?.meshes) ? json.meshes : [];
  const accessors = Array.isArray(json?.accessors) ? json.accessors : [];
  const parents = new Array(nodes.length).fill(-1);
  nodes.forEach((node, parent) => {
    for (const child of Array.isArray(node?.children) ? node.children : [])
      if (Number.isInteger(child) && child >= 0 && child < nodes.length && parents[child] === -1)
        parents[child] = parent;
  });

  const matrixCache = new Array(nodes.length);
  function worldMatrix(index, seen = new Set()) {
    if (matrixCache[index]) return matrixCache[index];
    if (seen.has(index)) return localNodeMatrix(nodes[index]);
    seen.add(index);
    const local = localNodeMatrix(nodes[index]);
    const parent = parents[index];
    matrixCache[index] = parent >= 0
      ? multiplyMatrix4(worldMatrix(parent, seen), local)
      : local;
    return matrixCache[index];
  }

  function ownMeshBox(nodeIndex) {
    const node = nodes[nodeIndex];
    const meshIndex = node?.mesh;
    if (!Number.isInteger(meshIndex) || !meshes[meshIndex]) return undefined;
    const box = emptyBox();
    let hasPositionBounds = false;
    const matrix = worldMatrix(nodeIndex);
    for (const primitive of meshes[meshIndex].primitives || []) {
      const accessorIndex = primitive?.attributes?.POSITION;
      const accessor = Number.isInteger(accessorIndex) ? accessors[accessorIndex] : undefined;
      if (!Array.isArray(accessor?.min) || !Array.isArray(accessor?.max) ||
          accessor.min.length !== 3 || accessor.max.length !== 3 ||
          ![...accessor.min, ...accessor.max].every(finite)) continue;
      hasPositionBounds = true;
      for (let mask = 0; mask < 8; mask += 1) {
        const point = [0, 1, 2].map((axis) =>
          mask & (1 << axis) ? accessor.max[axis] : accessor.min[axis]);
        extendBox(box, transformPoint(matrix, point));
      }
    }
    return hasPositionBounds ? box : undefined;
  }

  const nodeBounds = new Array(nodes.length);
  const active = new Set();
  function subtreeBox(index) {
    if (nodeBounds[index]) return nodeBounds[index];
    if (active.has(index)) return undefined;
    active.add(index);
    const box = emptyBox();
    mergeBox(box, ownMeshBox(index));
    for (const child of Array.isArray(nodes[index]?.children) ? nodes[index].children : [])
      mergeBox(box, subtreeBox(child));
    active.delete(index);
    nodeBounds[index] = box;
    return box;
  }

  const roots = Array.isArray(json?.scenes?.[json?.scene ?? 0]?.nodes)
    ? json.scenes[json.scene ?? 0].nodes
    : nodes.map((_node, index) => index).filter((index) => parents[index] < 0);
  const overall = emptyBox();
  for (const root of roots) mergeBox(overall, subtreeBox(root));
  nodes.forEach((_node, index) => mergeBox(overall, subtreeBox(index)));

  const modelSize = boxSize(overall);
  const meshNodes = nodes
    .map((node, index) => ({ node, index, box: ownMeshBox(index) }))
    .filter((item) => item.box);
  const groups = nodes
    .map((node, index) => ({ node, index, box: subtreeBox(index) }))
    .filter((item) => !Number.isInteger(item.node.mesh) &&
      item.box && item.box.min.every(Number.isFinite) && item.box.max.every(Number.isFinite));
  const candidates = [...meshNodes, ...groups].map(({ node, index, box }) => {
    const size = boxSize(box);
    return {
      name: String(node.name || "node-" + index).slice(0, 90),
      index,
      minY: box.min[1],
      maxY: box.max[1],
      height: size[1],
      width: size[0],
      depth: size[2],
      isGroup: !Number.isInteger(node.mesh),
    };
  }).filter((item) => item.height >= 2.3 && item.height <= 3.5 &&
    item.width >= modelSize[0] * 0.4 && item.depth >= modelSize[2] * 0.4);

  const histogram = new Map();
  for (const item of meshNodes) {
    const center = (item.box.min[1] + item.box.max[1]) / 2;
    const key = (Math.floor(center * 2) / 2).toFixed(1);
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }
  const sortedHistogram = [...histogram.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([centerY, count]) => centerY + ":" + count);

  return {
    nodeCount: nodes.length,
    meshCount: meshes.length,
    meshNodeCount: meshNodes.length,
    hierarchyGroupCount: groups.length,
    bounds: { min: overall.min.map((v) => Number(v.toFixed(3))), max: overall.max.map((v) => Number(v.toFixed(3))) },
    modelSize: modelSize.map((v) => Number(v.toFixed(3))),
    floorSizedCandidates: candidates.length,
    candidates: candidates.slice(0, 16).map(({ name, minY, maxY, width, depth, isGroup }) => ({
      name, minY: Number(minY.toFixed(3)), maxY: Number(maxY.toFixed(3)),
      width: Number(width.toFixed(3)), depth: Number(depth.toFixed(3)), isGroup,
    })),
    meshCenterHistogram: sortedHistogram.join(" "),
    namedNodes: nodes.map((node) => String(node?.name || "")).filter((name) =>
      /floor|storey|story|level|ground|stilt|roof|terrace/i.test(name)).slice(0, 30),
  };
}

async function inspectGlbGeometry(slug, modelUrl) {
  try {
    const url = absoluteUrl(modelUrl);
    if (!url) throw new Error("model URL missing");
    const loaded = await readGlbJsonDocument(url);
    if (loaded.format !== "glb-v2") {
      console.log("LIVE_MODEL_GEOMETRY: " + slug + " | " + JSON.stringify(loaded));
      return;
    }
    const report = inspectGltfGeometry(loaded.json);
    console.log("LIVE_MODEL_GEOMETRY: " + slug + " | " + JSON.stringify(report));
  } catch (error) {
    console.log("LIVE_MODEL_GEOMETRY_UNAVAILABLE: " + slug + " | " + String(error).slice(0, 260));
  }
}

async function verifyPage(slug) {
  const url = `${origin}/3Dprojects/${encodeURIComponent(slug)}`;
  const response = await fetchReady(url, { headers: { Accept: "text/html" } });
  const type = response.headers.get("content-type") || "";
  const html = await response.text();
  assert(type.toLowerCase().includes("text/html"), `Public Building page is not HTML for ${slug}.`);
  assert(/<div\s+id=["']root["']/i.test(html), `Public Building page is missing the app root for ${slug}.`);
  assert(/<script\b[^>]*type=["']module["']/i.test(html), `Public Building page is missing its module bundle for ${slug}.`);
  // Inspect the exact JavaScript bundle served by the live project route. This
  // distinguishes an old/stale public bundle from runtime floor-resolution issues.
  try {
    const scriptMatch = html.match(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>\s*<\/script>/i);
    if (!scriptMatch) throw new Error("module script source not found");
    const scriptUrl = absoluteUrl(scriptMatch[1]);
    const bundleResponse = await fetchReady(scriptUrl, { headers: { Accept: "text/javascript" } });
    const bundle = await bundleResponse.text();
    const floorControlsPresent =
      bundle.includes("Select building floor") &&
      bundle.includes("Show Ground Floor only") &&
      bundle.includes("client-floor-controls");
    console.log(
      "LIVE_PUBLIC_UI_BUNDLE: " + slug +
      " | asset=" + new URL(scriptUrl).pathname +
      " | floorControls=" + floorControlsPresent,
    );
  } catch (error) {
    console.log("LIVE_PUBLIC_UI_BUNDLE_UNAVAILABLE: " + slug + " | " + String(error).slice(0, 240));
  }
}

async function verifyModel(slug, modelUrl) {
  const url = absoluteUrl(modelUrl);
  assert(url, `Published Building model URL is missing for ${slug}.`);

  let head;
  try {
    head = await fetchReady(url, { method: "HEAD" }, [200, 206]);
  } catch {
    head = undefined;
  }
  if (head?.ok) return;

  const range = await fetchReady(
    url,
    { method: "GET", headers: { Range: "bytes=0-3" } },
    [200, 206],
  );
  const bytes = new Uint8Array(await range.arrayBuffer());
  assert(bytes.byteLength > 0, `Published Building model returned an empty body for ${slug}.`);
}

function verifyCamera(slug, camera) {
  if (!camera) return;
  assert(Array.isArray(camera.position) && camera.position.length === 3, `Camera position is invalid for ${slug}.`);
  assert(Array.isArray(camera.target) && camera.target.length === 3, `Camera target is invalid for ${slug}.`);
  assert(camera.position.every(finite), `Camera position contains a non-finite value for ${slug}.`);
  assert(camera.target.every(finite), `Camera target contains a non-finite value for ${slug}.`);
  const distanceSq = camera.position.reduce((total, value, index) => {
    const delta = value - camera.target[index];
    return total + delta * delta;
  }, 0);
  assert(distanceSq > 1e-8, `Camera position and target collapse to the same point for ${slug}.`);
  if (camera.fov !== undefined) {
    assert(finite(camera.fov) && camera.fov >= 10 && camera.fov <= 120, `Camera FOV is unsafe for ${slug}.`);
  }
}

function verifyFloorSettings(slug, scenes) {
  const floorScene = Array.isArray(scenes)
    ? scenes.find((scene) => scene?.type === "typical-floor")
    : undefined;
  const settings = floorScene?.settings;
  if (!settings || typeof settings !== "object") return { floors: 0, units: 0 };

  const floorLevels = Array.isArray(settings.floorLevels) ? settings.floorLevels : [];
  const floors = Array.isArray(settings.floors) ? settings.floors : [];
  const floorIds = [];

  for (const item of floorLevels) {
    assert(item && finite(item.floor) && finite(item.elevationM), `Floor level contains invalid numeric data for ${slug}.`);
    if (item.topElevationM !== undefined)
      assert(finite(item.topElevationM), `Floor top elevation is invalid for ${slug}.`);
    floorIds.push(item.floor);
  }
  for (const floor of floors) {
    assert(finite(floor), `Configured floor ID is invalid for ${slug}.`);
    floorIds.push(floor);
  }
  assert(new Set(floorLevels.map((item) => item.floor)).size === floorLevels.length, `Floor levels contain duplicate floor IDs for ${slug}.`);

  const units = Array.isArray(settings.units) ? settings.units : [];
  for (const unit of units) {
    assert(typeof unit?.series === "string" && unit.series.trim(), `Unit series is missing for ${slug}.`);
    assert(typeof unit?.type === "string" && unit.type.trim(), `Unit type is missing for ${slug}.`);
    assert(finite(unit?.areaSqFt) && unit.areaSqFt > 0, `Unit area is invalid for ${slug}.`);
  }

  return { floors: new Set(floorIds).size, units: units.length };
}

function verifyWalkthrough(slug, walkthrough) {
  if (!walkthrough) return { rooms: 0, doors: 0 };
  assert(walkthrough.version === 1, `Unsupported walkthrough version for ${slug}.`);
  assert(finite(walkthrough.metresPerUnit) && walkthrough.metresPerUnit > 0, `Walkthrough scale is invalid for ${slug}.`);
  assert(Array.isArray(walkthrough.rooms), `Walkthrough rooms are invalid for ${slug}.`);
  assert(Array.isArray(walkthrough.doors), `Walkthrough doors are invalid for ${slug}.`);

  const roomIds = new Set();
  for (const room of walkthrough.rooms) {
    assert(typeof room?.id === "string" && room.id.trim(), `Walkthrough room ID is missing for ${slug}.`);
    assert(!roomIds.has(room.id), `Walkthrough room ID is duplicated for ${slug}: ${room.id}.`);
    roomIds.add(room.id);
    assert(finite(room.elevation) && finite(room.height) && room.height > 0, `Walkthrough room height/elevation is invalid for ${slug}.`);
    assert(Array.isArray(room.boundary) && room.boundary.length >= 3, `Walkthrough room boundary is incomplete for ${slug}: ${room.id}.`);
    for (const point of room.boundary) {
      assert(Array.isArray(point) && point.length === 2 && point.every(finite), `Walkthrough room boundary contains invalid coordinates for ${slug}: ${room.id}.`);
    }
  }

  const doorIds = new Set();
  for (const door of walkthrough.doors) {
    assert(typeof door?.id === "string" && door.id.trim(), `Walkthrough door ID is missing for ${slug}.`);
    assert(!doorIds.has(door.id), `Walkthrough door ID is duplicated for ${slug}: ${door.id}.`);
    doorIds.add(door.id);
    assert(Array.isArray(door.roomIds) && door.roomIds.length === 2, `Walkthrough door room link is invalid for ${slug}: ${door.id}.`);
    assert(door.roomIds.every((roomId) => roomIds.has(roomId)), `Walkthrough door references an unknown room for ${slug}: ${door.id}.`);
    for (const key of ["x", "y", "z", "width", "height", "rotationY"])
      assert(finite(door[key]), `Walkthrough door ${key} is invalid for ${slug}: ${door.id}.`);
    assert(door.width > 0 && door.height > 0, `Walkthrough door size is invalid for ${slug}: ${door.id}.`);
  }

  return { rooms: walkthrough.rooms.length, doors: walkthrough.doors.length };
}

const catalogUrl = `${origin}/3Dprojects/api/releases`;
const { body: catalog } = await getJson(catalogUrl);
assert(catalog?.releaseSchemaReady === true && Array.isArray(catalog?.releases), "Public immutable Building release catalog is not ready.");

let releases = catalog.releases;
if (requestedSlug) {
  releases = releases.filter((item) => item?.slug === requestedSlug);
  assert(releases.length === 1, `Requested demo project is not an active immutable Building release: ${requestedSlug}.`);
}

if (!releases.length) {
  console.log("NO_ACTIVE_BUILDING_RELEASES: production is healthy but there is no active immutable Building release to demo-check.");
  process.exit(0);
}

const summaries = [];
for (const release of releases) {
  assert(typeof release?.slug === "string" && release.slug.trim(), "Release catalog contains an invalid project slug.");
  assert(typeof release?.releaseId === "string" && release.releaseId.trim(), `Release ID is missing for ${release.slug}.`);
  assert(Number.isInteger(release?.version), `Release version is invalid for ${release.slug}.`);

  const slug = release.slug;
  const encodedSlug = encodeURIComponent(slug);
  const { body: publicProject } = await getJson(`${origin}/3Dprojects/api/projects/${encodedSlug}`);
  assert(publicProject?.project?.slug === slug, `Public project identity mismatch for ${slug}.`);
  assert(publicProject?.release?.id === release.releaseId, `Public project release ID mismatch for ${slug}.`);
  assert(Number(publicProject?.release?.version) === Number(release.version), `Public project release version mismatch for ${slug}.`);
  assert(typeof publicProject?.project?.name === "string" && publicProject.project.name.trim(), `Public project name is missing for ${slug}.`);
  assert(publicProject?.model?.available === true, `Published Building model is not available for ${slug}.`);

  await Promise.all([
    verifyPage(slug),
    verifyModel(slug, publicProject.model.url),
  ]);
  verifyCamera(slug, publicProject.camera);
  await inspectGlbGeometry(slug, publicProject.model.url);
  const floorSummary = verifyFloorSettings(slug, publicProject.scenes);
  const walkSummary = verifyWalkthrough(slug, publicProject.walkthrough);

  summaries.push({
    slug,
    name: publicProject.project.name,
    releaseId: release.releaseId,
    version: release.version,
    floors: floorSummary.floors,
    units: floorSummary.units,
    rooms: walkSummary.rooms,
    doors: walkSummary.doors,
  });
}

for (const item of summaries) {
  console.log(
    `BUILDING_DEMO_READY: ${item.slug} | ${item.name} | release=${item.releaseId}@v${item.version} | floors=${item.floors} | units=${item.units} | walkthrough=${item.rooms} rooms/${item.doors} doors`,
  );
}
console.log(`Production Building demo readiness verified for ${summaries.length} active immutable release(s).`);

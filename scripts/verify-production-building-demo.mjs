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

async function verifyPage(slug) {
  const url = `${origin}/3Dprojects/${encodeURIComponent(slug)}`;
  const response = await fetchReady(url, { headers: { Accept: "text/html" } });
  const type = response.headers.get("content-type") || "";
  const html = await response.text();
  assert(type.toLowerCase().includes("text/html"), `Public Building page is not HTML for ${slug}.`);
  assert(/<div\s+id=["']root["']/i.test(html), `Public Building page is missing the app root for ${slug}.`);
  assert(/<script\b[^>]*type=["']module["']/i.test(html), `Public Building page is missing its module bundle for ${slug}.`);
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

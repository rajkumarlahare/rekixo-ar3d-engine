const origin = String(
  process.env.REKIXO_PUBLIC_ORIGIN || "https://ar3dstudio.in",
).replace(/\/+$/, "");

async function json(url, allowed = [200]) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!allowed.includes(response.status)) {
    const body = await response.text();
    throw new Error(
      `Unexpected HTTP ${response.status} from ${url}: ${body.slice(0, 500)}`,
    );
  }
  if (response.status === 404) return { response, body: undefined };
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json"))
    throw new Error(`Expected JSON from ${url}, got ${type || "unknown type"}.`);
  return { response, body: await response.json() };
}

const catalogUrl = `${origin}/3Dprojects/api/releases`;
const { body: catalog } = await json(catalogUrl);
if (catalog?.releaseSchemaReady !== true || !Array.isArray(catalog?.releases))
  throw new Error("Public immutable release catalog is not ready.");

let checkedModels = 0;
let checkedGeo = 0;

for (const item of catalog.releases) {
  if (
    typeof item?.slug !== "string" ||
    typeof item?.releaseId !== "string" ||
    !Number.isInteger(item?.version)
  )
    throw new Error("Release catalog contains invalid identity data.");

  const slug = encodeURIComponent(item.slug);
  const activeUrl = `${origin}/3Dprojects/api/releases/projects/${slug}`;
  const { body: active } = await json(activeUrl);

  if (
    active?.release?.id !== item.releaseId ||
    Number(active?.release?.version) !== Number(item.version) ||
    active?.experience?.project?.slug !== item.slug ||
    typeof active?.release?.manifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(active.release.manifestSha256)
  )
    throw new Error(`Active Building release identity mismatch for ${item.slug}.`);

  const publicUrl = `${origin}/3Dprojects/api/projects/${slug}`;
  const { body: publicProject } = await json(publicUrl);
  if (
    publicProject?.project?.slug !== item.slug ||
    publicProject?.release?.id !== item.releaseId ||
    Number(publicProject?.release?.version) !== Number(item.version)
  )
    throw new Error(`Public Building runtime does not match active release for ${item.slug}.`);

  const modelUrl = active?.experience?.model?.url;
  if (typeof modelUrl === "string" && modelUrl.startsWith("/3Dprojects/")) {
    const response = await fetch(`${origin}${modelUrl}`, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        `Active Building model is unavailable for ${item.slug} (HTTP ${response.status}).`,
      );
    checkedModels += 1;
  }

  const geoUrl = `${origin}/3Dprojects/api/projects/${slug}/geo-placement`;
  const { response: geoResponse, body: geo } = await json(geoUrl, [200, 404]);
  if (geoResponse.status === 200) {
    if (
      geo?.project?.slug !== item.slug ||
      !geo?.release ||
      !geo?.sourceBuilding
    )
      throw new Error(`Active Geo runtime identity is invalid for ${item.slug}.`);
    checkedGeo += 1;
  }
}

console.log(
  `Production immutable release integrity verified: ${catalog.releases.length} Building release(s), ${checkedModels} model object(s), ${checkedGeo} active Geo release(s).`,
);

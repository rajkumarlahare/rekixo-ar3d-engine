import fs from "node:fs";
import path from "node:path";

const KiB = 1024;

function files(dir) {
  if (!fs.existsSync(dir)) throw new Error(`Missing build directory: ${dir}`);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      path: path.join(dir, entry.name),
      bytes: fs.statSync(path.join(dir, entry.name)).size,
    }));
}

function one(items, pattern, label) {
  const matches = items.filter((item) => pattern.test(item.name));
  if (matches.length !== 1)
    throw new Error(
      `${label}: expected exactly one matching build asset, found ${matches.length}: ${matches
        .map((item) => item.name)
        .join(", ")}`,
    );
  return matches[0];
}

function atMost(item, maxBytes, label) {
  if (item.bytes > maxBytes)
    throw new Error(
      `${label} exceeded budget: ${(item.bytes / KiB).toFixed(1)} KiB > ${(
        maxBytes / KiB
      ).toFixed(1)} KiB (${item.name})`,
    );
}

const publicAssets = files("apps/public/dist/assets");
const adminAssets = files("apps/admin/dist/assets");

const publicEntry = one(publicAssets, /^index-[^.]+\.js$/, "Public entry JS");
atMost(publicEntry, 980 * KiB, "Public entry JS");

const publicProfile = one(
  publicAssets,
  /^(?:referenceSourceV9Materials|referenceMaterials)-[^.]+\.js$/,
  "Public Reference Source V9 material chunk",
);
atMost(publicProfile, 40 * KiB, "Public profile material JS");

const adminProfile = one(
  adminAssets,
  /^(?:referenceSourceV9Materials|referenceMaterials)-[^.]+\.js$/,
  "Admin Reference Source V9 material chunk",
);
atMost(adminProfile, 40 * KiB, "Admin profile material JS");

const textureAsset = one(
  publicAssets,
  /^source-textures-[^.]+\.json$/,
  "Reference source texture asset",
);
atMost(textureAsset, 400 * KiB, "Reference source texture asset");

for (const item of [...publicAssets, ...adminAssets]) {
  if (/sourceTextureData/i.test(item.name))
    throw new Error(
      `Inline source texture JavaScript chunk returned unexpectedly: ${item.name}`,
    );
}

console.log(
  [
    `Public entry: ${(publicEntry.bytes / KiB).toFixed(1)} KiB`,
    `Public profile JS: ${(publicProfile.bytes / KiB).toFixed(1)} KiB`,
    `Admin profile JS: ${(adminProfile.bytes / KiB).toFixed(1)} KiB`,
    `Profile texture asset: ${(textureAsset.bytes / KiB).toFixed(1)} KiB`,
  ].join("\n"),
);

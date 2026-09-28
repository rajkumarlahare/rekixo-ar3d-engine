import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

function assertPackShape(pack) {
  if (!pack || pack.format !== "rekixo-source-pack" || pack.version !== 1)
    throw Error("Unsupported source pack.");
  if (!pack.project || typeof pack.project.slug !== "string")
    throw Error("Source pack project is missing.");
  if (!Array.isArray(pack.sources) || !pack.sources.length)
    throw Error("Source pack has no sources.");

  const ids = new Set();
  for (const source of pack.sources) {
    if (
      !source ||
      typeof source.id !== "string" ||
      ids.has(source.id) ||
      typeof source.filename !== "string" ||
      typeof source.byteSize !== "number" ||
      !Number.isSafeInteger(source.byteSize) ||
      source.byteSize < 0 ||
      typeof source.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(source.sha256)
    )
      throw Error("Invalid source pack item.");
    ids.add(source.id);
  }
}

async function sha256(file) {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    for await (const chunk of handle.readableWebStream())
      hash.update(Buffer.from(chunk));
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export async function verifySourcePackFiles(manifestPath, sourceDirectory) {
  const pack = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assertPackShape(pack);

  const verified = [];
  for (const source of pack.sources) {
    const file = path.join(sourceDirectory, source.filename);
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      throw Error(`Missing source file: ${source.filename}`);
    }
    if (!stat.isFile()) throw Error(`Source is not a file: ${source.filename}`);
    if (stat.size !== source.byteSize)
      throw Error(
        `Source size mismatch: ${source.filename} (expected ${source.byteSize}, got ${stat.size})`,
      );
    const digest = await sha256(file);
    if (digest.toLowerCase() !== source.sha256.toLowerCase())
      throw Error(`Source checksum mismatch: ${source.filename}`);
    verified.push({
      id: source.id,
      filename: source.filename,
      byteSize: stat.size,
      sha256: digest,
    });
  }

  return {
    format: pack.format,
    version: pack.version,
    project: pack.project,
    verified,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [manifestPath, sourceDirectory] = process.argv.slice(2);
  if (!manifestPath || !sourceDirectory)
    throw Error(
      "Usage: node scripts/verify-source-pack.mjs <source-pack.json> <source-directory>",
    );
  console.log(
    JSON.stringify(
      await verifySourcePackFiles(
        path.resolve(manifestPath),
        path.resolve(sourceDirectory),
      ),
      null,
      2,
    ),
  );
}

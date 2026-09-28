import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// Deployment-only: immutable web assets, never original CAD files or database writes.
const out = path.resolve("apps/admin/dist/published");
await fs.mkdir(out, { recursive: true });
const catalog = [];
for (const name of await fs.readdir("published")) {
  if (!name.endsWith(".json")) continue;
  const data = JSON.parse(
    await fs.readFile(path.join("published", name), "utf8"),
  );
  const slug = data.project.slug;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw Error("Invalid publication slug");
  const dir = path.join(out, slug);
  await fs.mkdir(dir, { recursive: true });
  for (const a of data.assets) {
    const url = new URL(a.sourceUrl);
    if (
      url.origin !== "https://github.com" ||
      !url.pathname.startsWith(
        "/rajkumarlahare/rekixo-ar3d-engine/releases/download/",
      )
    )
      throw Error("Unexpected model source");
    if (
      !/^[a-f0-9]{64}\.glb$/.test(a.path) ||
      a.path !== a.hash + ".glb" ||
      a.size > 25 * 1024 * 1024
    )
      throw Error("Invalid static model");
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`Model download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.length !== a.size ||
      createHash("sha256").update(bytes).digest("hex") !== a.hash
    )
      throw Error("Published model checksum mismatch");
    await fs.writeFile(path.join(dir, a.path), bytes);
    delete a.sourceUrl;
  }
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(data));
  catalog.push({ slug, name: data.project.name });
}
await fs.writeFile(path.join(out, "catalog.json"), JSON.stringify(catalog));
console.log(
  `Prepared ${catalog.length} published design(s) with verified model checksums.`,
);

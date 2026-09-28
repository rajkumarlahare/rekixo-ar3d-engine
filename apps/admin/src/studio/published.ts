import {
  id,
  validStudioSlug,
  validateProject,
  type Asset,
  type Project,
} from "./domain";
import { makeAsset, save } from "./storage";

export interface PublishedDesign {
  project: Project;
  files: Asset[];
}

export interface PublishedCatalogEntry {
  slug: string;
  name: string;
  source: "release" | "legacy-static";
  version?: number;
}

function validCatalogEntry(value: unknown): value is { slug: string; name: string } {
  const item = value as { slug?: unknown; name?: unknown };
  return (
    Boolean(item) &&
    typeof item.slug === "string" &&
    validStudioSlug(item.slug) &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    item.name.length <= 200
  );
}

async function releaseCatalog(): Promise<PublishedCatalogEntry[]> {
  const response = await fetch("/3Dprojects/api/releases", { cache: "no-store" });
  if (!response.ok) return [];
  const body = (await response.json()) as {
    releases?: Array<{
      slug?: string;
      name?: string;
      version?: number;
      studioAvailable?: boolean;
    }>;
  };
  if (!Array.isArray(body.releases)) return [];
  return body.releases
    .filter(
      (item) =>
        item.studioAvailable &&
        validCatalogEntry({ slug: item.slug, name: item.name }),
    )
    .map((item) => ({
      slug: item.slug!,
      name: item.name!,
      source: "release" as const,
      ...(Number.isInteger(item.version) ? { version: item.version } : {}),
    }));
}

async function legacyCatalog(): Promise<PublishedCatalogEntry[]> {
  const response = await fetch("/3Dprojects/published/catalog.json", {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const rows = await response.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(validCatalogEntry)
    .map((item) => ({
      slug: item.slug,
      name: item.name,
      source: "legacy-static" as const,
    }));
}

export async function loadPublishedCatalog(): Promise<PublishedCatalogEntry[]> {
  const [releaseEntries, legacyEntries] = await Promise.all([
    releaseCatalog().catch(() => []),
    legacyCatalog().catch(() => []),
  ]);
  const bySlug = new Map<string, PublishedCatalogEntry>();
  for (const entry of legacyEntries) bySlug.set(entry.slug, entry);
  for (const entry of releaseEntries) bySlug.set(entry.slug, entry);
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function loadReleasePublished(slug: string): Promise<PublishedDesign | undefined> {
  const response = await fetch(
    `/3Dprojects/api/releases/projects/${encodeURIComponent(slug)}/studio`,
    { cache: "no-store" },
  );
  if (response.status === 404) return undefined;
  if (
    response.ok &&
    !String(response.headers.get("content-type") || "")
      .toLowerCase()
      .includes("application/json")
  )
    return undefined;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      diagnostic?: string;
    };
    throw Error(
      body.diagnostic
        ? `${body.error ?? "Published release failed."} ${body.diagnostic}`
        : body.error ?? `Published release failed (${response.status}).`,
    );
  }

  const data = (await response.json()) as {
    format?: string;
    project?: Project;
    assets?: Array<{
      id?: string;
      name?: string;
      type?: string;
      size?: number;
      hash?: string;
      contentUrl?: string;
    }>;
  };
  if (
    data.format !== "rekixo-release-studio-1" ||
    !data.project ||
    !Array.isArray(data.assets)
  )
    throw Error("Invalid immutable Studio release.");

  validateProject(data.project);
  if (
    data.project.slug !== slug ||
    data.assets.length !== data.project.assets.length
  )
    throw Error("Immutable Studio release identity mismatch.");

  const files: Asset[] = [];
  for (const asset of data.assets) {
    if (
      typeof asset.id !== "string" ||
      !data.project.assets.includes(asset.id) ||
      files.some((file) => file.id === asset.id) ||
      typeof asset.name !== "string" ||
      typeof asset.type !== "string" ||
      !Number.isInteger(asset.size) ||
      Number(asset.size) < 0 ||
      typeof asset.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(asset.hash) ||
      typeof asset.contentUrl !== "string" ||
      !asset.contentUrl.startsWith("/3Dprojects/api/releases/")
    )
      throw Error("Invalid immutable Studio release asset.");

    const result = await fetch(asset.contentUrl, { cache: "no-store" });
    if (!result.ok)
      throw Error(`Published release asset could not be loaded: ${asset.name}`);
    const blob = await result.blob();
    if (blob.size !== asset.size)
      throw Error(`Published release asset size mismatch: ${asset.name}`);
    const file = await makeAsset(
      new File([blob], asset.name, { type: asset.type }),
      data.project.id,
    );
    if (file.hash !== asset.hash)
      throw Error(`Published release checksum mismatch: ${asset.name}`);
    files.push({ ...file, id: asset.id });
  }
  return { project: data.project, files };
}

async function loadLegacyPublished(slug: string): Promise<PublishedDesign> {
  const base = `/3Dprojects/published/${slug}/`;
  const response = await fetch(base + "manifest.json", { cache: "no-store" });
  if (!response.ok) throw Error("This design is not published.");
  const data = await response.json();
  validateProject(data.project);
  if (
    data.project.slug !== slug ||
    !Array.isArray(data.assets) ||
    data.assets.length !== data.project.assets.length
  )
    throw Error("Invalid published manifest.");

  const files: Asset[] = [];
  for (const asset of data.assets) {
    if (
      !data.project.assets.includes(asset.id) ||
      files.some((file) => file.id === asset.id) ||
      !/^[a-f0-9]{64}\.glb$/.test(asset.path) ||
      asset.path !== asset.hash + ".glb" ||
      asset.size > 100 * 1024 * 1024
    )
      throw Error("Invalid published asset.");
    const result = await fetch(base + asset.path);
    if (!result.ok) throw Error("Published model could not be loaded.");
    const blob = await result.blob();
    if (blob.size !== asset.size) throw Error("Published model size mismatch.");
    const file = await makeAsset(
      new File([blob], asset.name, { type: asset.type }),
      data.project.id,
    );
    if (file.hash !== asset.hash) throw Error("Published model checksum mismatch.");
    files.push({ ...file, id: asset.id });
  }
  return { project: data.project, files };
}

export async function loadPublished(slug: string): Promise<PublishedDesign> {
  if (!validStudioSlug(slug)) throw Error("Invalid published project.");
  const release = await loadReleasePublished(slug);
  return release ?? loadLegacyPublished(slug);
}

export async function importPublished(slug: string) {
  const { project, files } = await loadPublished(slug);
  const copy = structuredClone(project);
  copy.id = id();
  copy.slug = `${slug.slice(0, 60)}-${copy.id.slice(0, 8)}`;
  copy.updated = new Date().toISOString();
  delete copy.cloud;
  const remap = new Map(files.map((file) => [file.id, id()]));
  copy.assets = copy.assets.map((key) => remap.get(key)!);
  for (const scene of [copy.scene, ...copy.releases.map((release) => release.scene)]) {
    if (scene.modelId) scene.modelId = remap.get(scene.modelId);
    scene.rooms = scene.rooms.map((room) => ({
      ...room,
      ...(room.sourceAssetId
        ? { sourceAssetId: remap.get(room.sourceAssetId) }
        : {}),
    }));
  }
  await save(
    copy,
    files.map((file) => ({
      ...file,
      id: remap.get(file.id)!,
      projectId: copy.id,
    })),
  );
  return copy;
}

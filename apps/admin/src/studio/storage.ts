import {
  id,
  projectSlug,
  slugFromName,
  validateProject,
  type Asset,
  type Project,
} from "./domain";
let dbPromise: Promise<IDBDatabase> | undefined;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("rekixo-engine-studio", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("projects", { keyPath: "id" });
      req.result.createObjectStore("assets", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function read<T>(store: string, key?: string): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store);
    const req = key
      ? tx.objectStore(store).get(key)
      : tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const projects = async () =>
  (await read<Project[]>("projects")).map((p) => ({
    ...p,
    slug: projectSlug(p),
  }));
export const asset = (key: string) => read<Asset | undefined>("assets", key);
export async function save(p: Project, files: Asset[] = []) {
  validateProject(p);
  for (const f of files)
    if (f.projectId !== p.id || !p.assets.includes(f.id))
      throw Error("Asset ownership mismatch.");
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(["projects", "assets"], "readwrite");
    let failure: Error | undefined;
    const list = tx.objectStore("projects").getAll();
    list.onsuccess = () => {
      if (
        list.result.some(
          (other: Project) =>
            other.id !== p.id && projectSlug(other) === projectSlug(p),
        )
      ) {
        failure = Error(
          "This slug already belongs to another local project. Choose a different slug.",
        );
        tx.abort();
        return;
      }
      tx.objectStore("projects").put({ ...p, slug: projectSlug(p) });
      for (const f of files) tx.objectStore("assets").put(f);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        failure || tx.error || Error("Saving failed; storage may be full."),
      );
    tx.onerror = () => reject(tx.error);
  });
}
export async function makeAsset(file: File, projectId: string): Promise<Asset> {
  if (file.size > 100 * 1024 * 1024)
    throw Error("Use a model/reference smaller than 100 MB.");
  const bytes = await file.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  return {
    id: id(),
    projectId,
    name: file.name,
    type: file.type,
    size: file.size,
    hash,
    blob: file,
  };
}
function asBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function exportPackage(project: Project) {
  validateProject(project);
  const files = [];
  for (const key of project.assets) {
    const f = await asset(key);
    if (!f || f.projectId !== project.id)
      throw Error("A project asset is missing. Export stopped.");
    files.push({
      id: f.id,
      name: f.name,
      type: f.type,
      hash: f.hash,
      data: await asBase64(f.blob),
    });
  }
  return new Blob(
    [JSON.stringify({ format: "rekixo-studio-1", project, files })],
    { type: "application/json" },
  );
}
export async function importPackage(file: File): Promise<Project> {
  if (file.size > 256 * 1024 * 1024) throw Error("Package exceeds 256 MB.");
  const data = JSON.parse(await file.text());
  if (
    data.format !== "rekixo-studio-1" ||
    !Array.isArray(data.files) ||
    data.files.length > 100
  )
    throw Error("Not a Studio package.");
  validateProject(data.project);
  const p = structuredClone(data.project) as Project;
  p.id = id();
  p.slug = `${slugFromName(data.project.name)}-${p.id.slice(0, 8)}`;
  p.name += " (imported)";
  delete p.cloud;
  p.updated = new Date().toISOString();
  const files: Asset[] = [],
    remap = new Map<string, string>();
  for (const f of data.files) {
    if (
      typeof f.id !== "string" ||
      !p.assets.includes(f.id) ||
      remap.has(f.id) ||
      typeof f.data !== "string" ||
      typeof f.name !== "string" ||
      typeof f.type !== "string"
    )
      throw Error("Invalid package asset.");
    const raw = atob(f.data);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const a = await makeAsset(
      new File([bytes], f.name, { type: f.type }),
      p.id,
    );
    if (a.hash !== f.hash) throw Error(`Checksum mismatch: ${f.name}`);
    remap.set(f.id, a.id);
    files.push(a);
  }
  if (files.length !== p.assets.length)
    throw Error("Package is missing assets.");
  p.assets = p.assets.map((k) => remap.get(k)!);
  for (const s of [p.scene, ...p.releases.map((r) => r.scene)]) {
    if (s.modelId) s.modelId = remap.get(s.modelId);
    s.referenceLayers = (s.referenceLayers ?? []).map((layer) => ({
      ...layer,
      assetId: remap.get(layer.assetId)!,
    }));
    s.rooms = s.rooms.map((room) => ({
      ...room,
      ...(room.sourceAssetId
        ? { sourceAssetId: remap.get(room.sourceAssetId) }
        : {}),
    }));
  }
  await save(p, files);
  return p;
}
export async function duplicateProject(source: Project): Promise<Project> {
  validateProject(source);
  const p = structuredClone(source);
  p.id = id();
  p.name = `${source.name.slice(0, 190)} copy`;
  p.slug = `${slugFromName(source.name)}-${p.id.slice(0, 8)}`;
  p.updated = new Date().toISOString();
  delete p.cloud;
  p.releases = [];
  p.scene.rooms = p.scene.rooms.map((r) => ({ ...r, verified: false }));
  const files: Asset[] = [];
  const remap = new Map<string, string>();
  for (const key of source.assets) {
    const f = await asset(key);
    if (!f || f.projectId !== source.id)
      throw Error("A source asset is missing; copy stopped.");
    const key2 = id();
    remap.set(key, key2);
    files.push({ ...f, id: key2, projectId: p.id });
  }
  p.assets = files.map((f) => f.id);
  if (p.scene.modelId) p.scene.modelId = remap.get(p.scene.modelId);
  p.scene.referenceLayers = (p.scene.referenceLayers ?? []).map((layer) => ({
    ...layer,
    assetId: remap.get(layer.assetId)!,
  }));
  p.scene.rooms = p.scene.rooms.map((room) => ({
    ...room,
    ...(room.sourceAssetId
      ? { sourceAssetId: remap.get(room.sourceAssetId) }
      : {}),
  }));
  await save(p, files);
  return p;
}

export async function removeAssetIfUnreferenced(assetId: string) {
  const database = await db();
  const entries = await read<Project[]>("projects");
  if (entries.some((project) => project.assets.includes(assetId))) return false;
  return new Promise<boolean>((resolve, reject) => {
    const tx = database.transaction("assets", "readwrite");
    tx.objectStore("assets").delete(assetId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Asset cache cleanup failed."));
  });
}

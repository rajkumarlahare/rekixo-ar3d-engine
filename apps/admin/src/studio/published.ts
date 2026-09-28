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
export async function loadPublished(slug: string): Promise<PublishedDesign> {
  if (!validStudioSlug(slug)) throw Error("Invalid published project.");
  const base = `/3Dprojects/published/${slug}/`;
  const response = await fetch(base + "manifest.json");
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
  for (const a of data.assets) {
    if (
      !data.project.assets.includes(a.id) ||
      files.some((f) => f.id === a.id) ||
      !/^[a-f0-9]{64}\.glb$/.test(a.path) ||
      a.path !== a.hash + ".glb" ||
      a.size > 100 * 1024 * 1024
    )
      throw Error("Invalid published asset.");
    const result = await fetch(base + a.path);
    if (!result.ok) throw Error("Published model could not be loaded.");
    const blob = await result.blob();
    if (blob.size !== a.size) throw Error("Published model size mismatch.");
    const file = await makeAsset(
      new File([blob], a.name, { type: a.type }),
      data.project.id,
    );
    if (file.hash !== a.hash) throw Error("Published model checksum mismatch.");
    files.push({ ...file, id: a.id });
  }
  return { project: data.project, files };
}
export async function importPublished(slug: string) {
  const { project, files } = await loadPublished(slug);
  const copy = structuredClone(project);
  copy.id = id();
  copy.slug = `${slug.slice(0, 60)}-${copy.id.slice(0, 8)}`;
  copy.updated = new Date().toISOString();
  const remap = new Map(files.map((f) => [f.id, id()]));
  copy.assets = copy.assets.map((key) => remap.get(key)!);
  for (const scene of [copy.scene, ...copy.releases.map((r) => r.scene)])
    if (scene.modelId) scene.modelId = remap.get(scene.modelId);
  await save(
    copy,
    files.map((f) => ({ ...f, id: remap.get(f.id)!, projectId: copy.id })),
  );
  return copy;
}

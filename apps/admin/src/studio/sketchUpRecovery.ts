import type { Asset, Project } from "./domain";
import * as storage from "./storage";
import { extractSketchUpTextures } from "./sketchUpArchive";

export interface SketchUpTextureRecoveryResult {
  assets: Asset[];
  nextProject: Project;
  issues: string[];
  archives: number;
  recoveredFiles: number;
}

export async function prepareSketchUpTextureRecovery(
  files: readonly Asset[],
  project: Project,
): Promise<SketchUpTextureRecoveryResult> {
  const archives = files.filter((asset) => /\.(?:skb|skp)$/i.test(asset.name));
  if (!archives.length)
    throw Error("Attach a SketchUp SKB/SKP source before recovering textures.");

  const recoveredFiles: File[] = [];
  const issues: string[] = [];
  for (const archive of archives) {
    const recovered = await extractSketchUpTextures(archive);
    issues.push(...recovered.issues);
    for (const texture of recovered.textures)
      recoveredFiles.push(
        new File([texture.blob], texture.name, {
          type: texture.type,
          lastModified: Date.now(),
        }),
      );
  }

  const incoming = await Promise.all(
    recoveredFiles.map((file) => storage.makeAsset(file, project.id)),
  );
  const known = new Set(files.map((asset) => asset.hash.toLowerCase()));
  const batch = new Set<string>();
  const assets = incoming.filter((asset) => {
    const hash = asset.hash.toLowerCase();
    if (known.has(hash) || batch.has(hash)) return false;
    batch.add(hash);
    return true;
  });
  const existing = new Set(project.assets);
  return {
    assets,
    issues,
    archives: archives.length,
    recoveredFiles: recoveredFiles.length,
    nextProject: {
      ...project,
      assets: [
        ...project.assets,
        ...assets.map((asset) => asset.id).filter((id) => !existing.has(id)),
      ],
    },
  };
}

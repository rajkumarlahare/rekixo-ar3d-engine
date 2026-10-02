import type { Asset, Project } from "./domain";
import * as storage from "./storage";
import { extractSketchUpTextures } from "./sketchUpArchive";
import { auditFbxSources } from "./sourceAudit";

function leaf(value: string) {
  return value.replaceAll("\\", "/").split("/").pop() ?? value;
}

function normalizedStem(value: string) {
  return leaf(value)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizedPath(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function canonicalRecoveredTextureName(
  archivePath: string,
  recoveredName: string,
  expectedNames: readonly string[],
) {
  const recoveredLeaf = leaf(recoveredName).toLowerCase();
  const recoveredStem = normalizedStem(recoveredName);
  const folderPath = archivePath
    .replaceAll("\\", "/")
    .split("/")
    .slice(0, -1)
    .join("/");
  const normalizedFolder = normalizedPath(folderPath);
  const normalizedArchive = normalizedPath(archivePath);

  const ranked = expectedNames
    .map((expected) => {
      const expectedLeaf = leaf(expected);
      const expectedLower = expectedLeaf.toLowerCase();
      const expectedStem = normalizedStem(expectedLeaf);
      let score = 0;
      if (expectedLower === recoveredLeaf) score = 5;
      else if (expectedStem && normalizedFolder.includes(expectedStem)) score = 4;
      else if (expectedStem === recoveredStem) score = 3;
      else if (expectedStem && normalizedArchive.includes(expectedStem)) score = 2;
      return { expected: expectedLeaf, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.expected.localeCompare(right.expected),
    );

  if (!ranked.length) return recoveredName;
  if (
    ranked.length > 1 &&
    ranked[0].score === ranked[1].score &&
    ranked[0].expected.toLowerCase() !== ranked[1].expected.toLowerCase()
  )
    return recoveredName;
  return ranked[0].expected;
}

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
  const fbxAudits = await auditFbxSources([...files]);
  const expectedTextureNames = [
    ...new Set(
      fbxAudits.flatMap((audit) =>
        audit.externalTextureFiles.map((value) => leaf(value)),
      ),
    ),
  ];
  for (const archive of archives) {
    const recovered = await extractSketchUpTextures(archive);
    issues.push(...recovered.issues);
    for (const texture of recovered.textures) {
      const canonicalName = canonicalRecoveredTextureName(
        texture.archivePath,
        texture.name,
        expectedTextureNames,
      );
      recoveredFiles.push(
        new File([texture.blob], canonicalName, {
          type: texture.type,
          lastModified: Date.now(),
        }),
      );
    }
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

import type { Asset, Project } from "./domain";
import * as storage from "./storage";
import {
  extractSketchUpMaterialDefinitions,
  extractSketchUpTextures,
} from "./sketchUpArchive";
import { auditFbxSources } from "./sourceAudit";
import {
  materialNameFromArchivePath,
  type SketchUpMaterialStyleBinding,
  type SketchUpMaterialTextureBinding,
} from "./sketchUpMaterialResolver";

function leaf(value: string) {
  return value.replaceAll("\\", "/").split("/").pop() ?? value;
}

function stem(value: string) {
  return leaf(value).replace(/\.[^.]+$/, "");
}

function normalizedStem(value: string) {
  return stem(value)
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

interface RecoveredTextureRow {
  sourceArchiveId: string;
  archivePath: string;
  materialName: string;
  confidence: number;
  file: File;
}

export interface SketchUpTextureRecoveryResult {
  assets: Asset[];
  nextProject: Project;
  issues: string[];
  archives: number;
  recoveredFiles: number;
  materialBindings: SketchUpMaterialTextureBinding[];
  materialStyles: SketchUpMaterialStyleBinding[];
}

function equivalentByHash(
  candidates: readonly Asset[],
  target: Asset,
): Asset | undefined {
  return candidates.find(
    (candidate) =>
      candidate.hash.toLowerCase() === target.hash.toLowerCase() &&
      candidate.size === target.size &&
      candidate.type === target.type,
  );
}

export async function prepareSketchUpTextureRecovery(
  files: readonly Asset[],
  project: Project,
): Promise<SketchUpTextureRecoveryResult> {
  const archives = files.filter((asset) => /\.(?:skb|skp)$/i.test(asset.name));
  if (!archives.length)
    throw Error("Attach a SketchUp SKB/SKP source before recovering textures.");

  const recoveredRows: RecoveredTextureRow[] = [];
  const materialStyles: SketchUpMaterialStyleBinding[] = [];
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
    const definitions = await extractSketchUpMaterialDefinitions(archive);
    issues.push(...definitions.issues);
    for (const definition of definitions.definitions) {
      materialStyles.push({
        sourceArchiveId: archive.id,
        archivePath: definition.archivePath,
        materialName: definition.name,
        ...(definition.baseColor ? { baseColor: definition.baseColor } : {}),
        ...(definition.opacity !== undefined
          ? { opacity: definition.opacity }
          : {}),
        ...(definition.xScale !== undefined ? { xScale: definition.xScale } : {}),
        ...(definition.yScale !== undefined ? { yScale: definition.yScale } : {}),
        confidence: 0.99,
      });
    }

    const recovered = await extractSketchUpTextures(archive);
    issues.push(...recovered.issues);
    for (const texture of recovered.textures) {
      const canonicalName = canonicalRecoveredTextureName(
        texture.archivePath,
        texture.name,
        expectedTextureNames,
      );
      const materialName =
        materialNameFromArchivePath(texture.archivePath) ??
        stem(canonicalName).trim() ??
        stem(texture.name).trim();
      recoveredRows.push({
        sourceArchiveId: archive.id,
        archivePath: texture.archivePath,
        materialName: materialName || stem(texture.name),
        confidence: materialNameFromArchivePath(texture.archivePath) ? 0.98 : 0.72,
        file: new File([texture.blob], canonicalName, {
          type: texture.type,
          lastModified: Date.now(),
        }),
      });
    }
  }

  const incoming = await Promise.all(
    recoveredRows.map((row) => storage.makeAsset(row.file, project.id)),
  );
  const resolvedAssets: Asset[] = [];
  const createdAssets: Asset[] = [];
  const available: Asset[] = [...files];

  for (const candidate of incoming) {
    const equivalent = equivalentByHash(available, candidate);
    const resolved = equivalent ?? candidate;
    resolvedAssets.push(resolved);
    if (!equivalent) {
      available.push(candidate);
      createdAssets.push(candidate);
    }
  }

  const materialBindings: SketchUpMaterialTextureBinding[] = [];
  const seenBinding = new Set<string>();
  recoveredRows.forEach((row, index) => {
    const asset = resolvedAssets[index];
    if (!asset) return;
    const key = `${row.sourceArchiveId}\u0000${row.materialName.toLowerCase()}\u0000${asset.id}`;
    if (seenBinding.has(key)) return;
    seenBinding.add(key);
    materialBindings.push({
      sourceArchiveId: row.sourceArchiveId,
      archivePath: row.archivePath,
      materialName: row.materialName,
      textureAssetId: asset.id,
      textureName: asset.name,
      confidence: row.confidence,
    });
  });

  const existing = new Set(project.assets);
  return {
    assets: createdAssets,
    issues,
    archives: archives.length,
    recoveredFiles: recoveredRows.length,
    materialBindings,
    materialStyles,
    nextProject: {
      ...project,
      assets: [
        ...project.assets,
        ...createdAssets
          .map((asset) => asset.id)
          .filter((assetId) => !existing.has(assetId)),
      ],
    },
  };
}

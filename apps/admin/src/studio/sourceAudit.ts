import type { Asset } from "./domain";

export interface FbxSourceAudit {
  assetId: string;
  filename: string;
  ascii: boolean;
  materialNames: string[];
  externalTextureFiles: string[];
  matchedTextureFiles: string[];
  meshCount?: number;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function basename(path: string) {
  return path.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
}

export async function auditFbxSources(files: Asset[]): Promise<FbxSourceAudit[]> {
  const attachedNames = new Set(files.map((file) => basename(file.name)));
  const results: FbxSourceAudit[] = [];

  for (const file of files.filter((item) => /\.fbx$/i.test(item.name))) {
    const head = await file.blob.slice(0, 32).text();
    const ascii = !head.startsWith("Kaydara FBX Binary");
    if (!ascii) {
      results.push({
        assetId: file.id,
        filename: file.name,
        ascii: false,
        materialNames: [],
        externalTextureFiles: [],
        matchedTextureFiles: [],
      });
      continue;
    }

    const source = await file.blob.text();
    const materialNames = unique(
      [...source.matchAll(/Material:\s*\d+,\s*"Material::([^"]*)"/g)].map(
        (match) => match[1],
      ),
    );
    const externalTextureFiles = unique(
      [...source.matchAll(/RelativeFilename:\s*"([^"]*)"/g)].map(
        (match) => match[1],
      ),
    );
    const meshCount = [
      ...source.matchAll(/Geometry:\s*\d+,\s*"Geometry::[^"]*",\s*"Mesh"/g),
    ].length;
    const matchedTextureFiles = externalTextureFiles.filter((path) =>
      attachedNames.has(basename(path)),
    );

    results.push({
      assetId: file.id,
      filename: file.name,
      ascii: true,
      materialNames,
      externalTextureFiles,
      matchedTextureFiles,
      meshCount,
    });
  }

  return results;
}

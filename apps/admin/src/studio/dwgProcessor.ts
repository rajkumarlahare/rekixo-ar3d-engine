import type { Asset } from "./domain";
import * as storage from "./storage";
import {
  DWG_NORMALIZED_MIME,
  dwgNormalizedAssetName,
  parseDwgNormalizedDocument,
  type DwgNormalizedDocument,
} from "./dwgNormalized";

export type DwgArchitectureProcessor = (
  source: Asset,
) => Promise<DwgNormalizedDocument | unknown>;

export interface DwgArchitectureDerivativeResult {
  asset: Asset;
  document: DwgNormalizedDocument;
}

export async function prepareDwgArchitectureDerivative(
  source: Asset,
  projectId: string,
  processor: DwgArchitectureProcessor,
): Promise<DwgArchitectureDerivativeResult> {
  if (!/\.dwg$/i.test(source.name))
    throw Error("Choose a DWG source before preparing architecture geometry.");
  if (source.projectId !== projectId)
    throw Error("DWG source does not belong to this project.");
  if (source.size > 32 * 1024 * 1024)
    throw Error("DWG exceeds the 32 MB architecture processor limit.");

  const response = await processor(source);
  const document = parseDwgNormalizedDocument(response, source);
  const serialized = JSON.stringify(document);
  const file = new File(
    [serialized],
    dwgNormalizedAssetName(source.name),
    {
      type: DWG_NORMALIZED_MIME,
      lastModified: Date.now(),
    },
  );
  const asset = await storage.makeAsset(file, projectId);
  return { asset, document };
}

import type { Asset } from "./domain";

export interface SketchUpArchiveInspection {
  zipLike: boolean;
  entryCount: number;
  materialDefinitionFiles: string[];
  textureFiles: string[];
  modelFiles: string[];
  previewFiles: string[];
  issues: string[];
}

const decoder = new TextDecoder();

function u16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}
function u32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const min = Math.max(0, bytes.length - 65_557);
  for (let index = bytes.length - 22; index >= min; index -= 1)
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x05 &&
      bytes[index + 3] === 0x06
    )
      return index;
  return -1;
}

export async function inspectSketchUpArchive(
  asset: Asset,
): Promise<SketchUpArchiveInspection> {
  const result: SketchUpArchiveInspection = {
    zipLike: false,
    entryCount: 0,
    materialDefinitionFiles: [],
    textureFiles: [],
    modelFiles: [],
    previewFiles: [],
    issues: [],
  };
  if (!/\.(skb|skp)$/i.test(asset.name)) return result;

  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  if (bytes.length < 22) {
    result.issues.push("SketchUp source is too small to inspect.");
    return result;
  }
  const end = findEndOfCentralDirectory(bytes);
  if (end < 0) {
    result.issues.push(
      "Source is not a ZIP-style SketchUp archive; native SketchUp decoding is still required.",
    );
    return result;
  }

  result.zipLike = true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalEntries = u16(view, end + 10);
  const centralSize = u32(view, end + 12);
  const centralOffset = u32(view, end + 16);
  if (
    totalEntries > 10_000 ||
    centralOffset + centralSize > bytes.length ||
    centralOffset < 0
  ) {
    result.issues.push("SketchUp archive directory is outside safe inspection limits.");
    return result;
  }

  let offset = centralOffset;
  const names: string[] = [];
  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (offset + 46 > bytes.length || u32(view, offset) !== 0x02014b50) {
      result.issues.push("SketchUp archive central directory is truncated.");
      break;
    }
    const fileNameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const start = offset + 46;
    const finish = start + fileNameLength;
    if (finish > bytes.length) {
      result.issues.push("SketchUp archive contains an invalid file name entry.");
      break;
    }
    const name = decoder.decode(bytes.subarray(start, finish)).replaceAll("\\", "/");
    if (name && !name.endsWith("/")) names.push(name);
    offset = finish + extraLength + commentLength;
  }

  result.entryCount = names.length;
  const image = /\.(?:png|jpe?g|webp|bmp|tiff?)$/i;
  result.materialDefinitionFiles = names.filter(
    (name) =>
      /(?:^|\/)(?:material|materials)(?:\/|$)/i.test(name) &&
      /\.(?:xml|json|dat)$/i.test(name),
  );
  result.textureFiles = names.filter(
    (name) =>
      image.test(name) &&
      /(?:material|texture|image|resource)/i.test(name),
  );
  result.modelFiles = names.filter(
    (name) => /(?:model\.dat|\.skp$|\.skb$)/i.test(name),
  );
  result.previewFiles = names.filter(
    (name) => image.test(name) && /(?:thumb|preview)/i.test(name),
  );
  return result;
}

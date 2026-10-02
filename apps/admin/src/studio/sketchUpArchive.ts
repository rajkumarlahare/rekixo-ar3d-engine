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

export interface ExtractedSketchUpTexture {
  archivePath: string;
  name: string;
  type: string;
  blob: Blob;
}

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
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

function findFirstLocalHeader(bytes: Uint8Array) {
  const limit = Math.min(bytes.length - 4, 1024 * 1024);
  for (let index = 0; index <= limit; index += 1)
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x03 &&
      bytes[index + 3] === 0x04
    )
      return index;
  return -1;
}

function parseZipEntries(bytes: Uint8Array) {
  const issues: string[] = [];
  if (bytes.length < 22)
    return { zipLike: false, entries: [] as ZipEntry[], issues: ["SketchUp source is too small to inspect."] };

  const end = findEndOfCentralDirectory(bytes);
  if (end < 0)
    return {
      zipLike: false,
      entries: [] as ZipEntry[],
      issues: [
        "Source is not a ZIP-style SketchUp archive; native SketchUp decoding is still required.",
      ],
    };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalEntries = u16(view, end + 10);
  const centralSize = u32(view, end + 12);
  const relativeCentralOffset = u32(view, end + 16);
  const firstLocalHeader = findFirstLocalHeader(bytes);
  // ZIP offsets are relative to the start of the ZIP payload, not necessarily
  // byte zero of an SKB container. Infer the payload base from the EOCD first;
  // fall back to a discovered local header/zero only when needed.
  const inferredZipBase = end - centralSize - relativeCentralOffset;
  const candidateBases = [
    inferredZipBase,
    firstLocalHeader,
    0,
  ].filter(
    (value, index, values) =>
      value >= 0 && values.indexOf(value) === index,
  );
  const zipBase =
    candidateBases.find((base) => {
      const offset = base + relativeCentralOffset;
      return (
        offset + 4 <= bytes.length &&
        u32(view, offset) === 0x02014b50
      );
    }) ?? inferredZipBase;
  const centralOffset = zipBase + relativeCentralOffset;
  if (
    totalEntries > 10_000 ||
    zipBase < 0 ||
    centralOffset < zipBase ||
    centralOffset + centralSize > bytes.length
  )
    return {
      zipLike: true,
      entries: [] as ZipEntry[],
      issues: ["SketchUp archive directory is outside safe inspection limits."],
    };

  let offset = centralOffset;
  const entries: ZipEntry[] = [];
  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (offset + 46 > bytes.length || u32(view, offset) !== 0x02014b50) {
      issues.push("SketchUp archive central directory is truncated.");
      break;
    }
    const compressionMethod = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const fileNameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localHeaderOffset = zipBase + u32(view, offset + 42);
    const start = offset + 46;
    const finish = start + fileNameLength;
    if (finish > bytes.length) {
      issues.push("SketchUp archive contains an invalid file name entry.");
      break;
    }
    const name = decoder
      .decode(bytes.subarray(start, finish))
      .replaceAll("\\", "/");
    if (name && !name.endsWith("/"))
      entries.push({
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    offset = finish + extraLength + commentLength;
  }
  return { zipLike: true, entries, issues };
}

function imageMime(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "image/jpeg";
}

function textureEntries(entries: readonly ZipEntry[]) {
  const image = /\.(?:png|jpe?g|webp|bmp|tiff?)$/i;
  return entries.filter(
    (entry) =>
      image.test(entry.name) &&
      /(?:material|texture|image|resource)/i.test(entry.name),
  );
}

function blobBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined")
    throw Error("This browser cannot decompress SketchUp archive textures.");
  const stream = new Blob([blobBuffer(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractEntry(
  archive: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  if (entry.uncompressedSize > 8 * 1024 * 1024)
    throw Error(`SketchUp texture is too large to extract safely: ${entry.name}`);

  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const offset = entry.localHeaderOffset;
  if (offset + 30 > archive.length || u32(view, offset) !== 0x04034b50)
    throw Error(`SketchUp archive local header is invalid: ${entry.name}`);
  const nameLength = u16(view, offset + 26);
  const extraLength = u16(view, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (start < 0 || end > archive.length)
    throw Error(`SketchUp archive texture bytes are truncated: ${entry.name}`);
  const compressed = archive.subarray(start, end);

  let output: Uint8Array;
  if (entry.compressionMethod === 0) output = new Uint8Array(compressed);
  else if (entry.compressionMethod === 8) output = await inflateRaw(compressed);
  else
    throw Error(
      `Unsupported SketchUp ZIP compression method ${entry.compressionMethod}: ${entry.name}`,
    );

  if (
    entry.uncompressedSize &&
    output.byteLength !== entry.uncompressedSize
  )
    throw Error(`SketchUp texture size verification failed: ${entry.name}`);
  return output;
}

function safeLeaf(name: string) {
  const leaf = name.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  return leaf.replace(/[^a-z0-9._ -]+/gi, "_").slice(0, 180);
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
  const parsed = parseZipEntries(bytes);
  result.zipLike = parsed.zipLike;
  result.issues.push(...parsed.issues);
  const names = parsed.entries.map((entry) => entry.name);
  result.entryCount = names.length;
  const image = /\.(?:png|jpe?g|webp|bmp|tiff?)$/i;
  result.materialDefinitionFiles = names.filter(
    (name) =>
      /(?:^|\/)(?:material|materials)(?:\/|$)/i.test(name) &&
      /\.(?:xml|json|dat)$/i.test(name),
  );
  result.textureFiles = textureEntries(parsed.entries).map(
    (entry) => entry.name,
  );
  result.modelFiles = names.filter(
    (name) => /(?:model\.dat|\.skp$|\.skb$)/i.test(name),
  );
  result.previewFiles = names.filter(
    (name) => image.test(name) && /(?:thumb|preview)/i.test(name),
  );
  return result;
}

export async function extractSketchUpTextures(
  asset: Asset,
): Promise<{ textures: ExtractedSketchUpTexture[]; issues: string[] }> {
  if (!/\.(skb|skp)$/i.test(asset.name))
    return { textures: [], issues: ["Choose a SketchUp SKB/SKP archive first."] };

  const archive = new Uint8Array(await asset.blob.arrayBuffer());
  const parsed = parseZipEntries(archive);
  if (!parsed.zipLike)
    return { textures: [], issues: parsed.issues };

  const entries = textureEntries(parsed.entries).slice(0, 250);
  const textures: ExtractedSketchUpTexture[] = [];
  const issues = [...parsed.issues];
  let total = 0;
  const names = new Map<string, number>();

  for (const entry of entries) {
    if (total + entry.uncompressedSize > 32 * 1024 * 1024) {
      issues.push(
        "SketchUp texture extraction stopped at the 32 MB recovered-texture safety limit.",
      );
      break;
    }
    try {
      const bytes = await extractEntry(archive, entry);
      total += bytes.byteLength;
      const base = safeLeaf(entry.name) || "texture.jpg";
      const count = (names.get(base.toLowerCase()) ?? 0) + 1;
      names.set(base.toLowerCase(), count);
      const name =
        count === 1
          ? base
          : base.replace(/(\.[^.]+)?$/, (suffix) => `-${count}${suffix ?? ""}`);
      textures.push({
        archivePath: entry.name,
        name,
        type: imageMime(base),
        blob: new Blob([blobBuffer(bytes)], { type: imageMime(base) }),
      });
    } catch (error) {
      issues.push(
        error instanceof Error
          ? error.message
          : `Could not extract SketchUp texture: ${entry.name}`,
      );
    }
  }

  return { textures, issues };
}

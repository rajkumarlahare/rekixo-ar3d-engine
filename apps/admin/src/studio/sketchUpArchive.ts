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

export interface ExtractedSketchUpMaterialDefinition {
  archivePath: string;
  name: string;
  textureName?: string;
  baseColor?: string;
  opacity?: number;
  xScale?: number;
  yScale?: number;
}

export interface SketchUpSemanticEvidence {
  modelDataFiles: string[];
  readableStrings: string[];
  tagCandidates: string[];
  componentCandidates: string[];
  architecturalTokens: string[];
  issues: string[];
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

function materialNameFromPath(path: string) {
  const parts = path.replaceAll("\\", "/").split("/");
  const index = parts.findIndex((part) => /^materials?$/i.test(part));
  if (index < 0 || index + 1 >= parts.length) return undefined;
  return parts[index + 1].replace(/^\[|\]$/g, "").trim() || undefined;
}

function xmlTextValue(source: string, names: readonly string[]) {
  for (const name of names) {
    const match = source.match(
      new RegExp(
        `<(?:[a-z0-9_]+:)?${name}\\b[^>]*>\\s*([^<]+?)\\s*<\\/(?:[a-z0-9_]+:)?${name}>`,
        "i",
      ),
    );
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function finiteValue(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function colorChannel(value: number) {
  const scaled = value <= 1 ? value * 255 : value;
  return Math.max(0, Math.min(255, Math.round(scaled)));
}

function rgbHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => colorChannel(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

function materialColor(source: string) {
  const direct = source.match(
    /<(?:[a-z0-9_]+:)?color\b[^>]*>\s*#([0-9a-f]{6})\s*</i,
  );
  if (direct?.[1]) return `#${direct[1].toLowerCase()}`;

  const red = finiteValue(xmlTextValue(source, ["red", "r"]));
  const green = finiteValue(xmlTextValue(source, ["green", "g"]));
  const blue = finiteValue(xmlTextValue(source, ["blue", "b"]));
  if (red !== undefined && green !== undefined && blue !== undefined)
    return rgbHex(red, green, blue);

  const triplet = xmlTextValue(source, ["color", "rgb"])?.match(
    /(-?\d+(?:\.\d+)?)\D+(-?\d+(?:\.\d+)?)\D+(-?\d+(?:\.\d+)?)/,
  );
  if (triplet)
    return rgbHex(
      Number.parseFloat(triplet[1]),
      Number.parseFloat(triplet[2]),
      Number.parseFloat(triplet[3]),
    );
  return undefined;
}

function materialOpacity(source: string) {
  const opacity = finiteValue(xmlTextValue(source, ["opacity", "alpha"]));
  if (opacity !== undefined)
    return Math.max(0, Math.min(1, opacity > 1 ? opacity / 255 : opacity));
  const transparency = finiteValue(
    xmlTextValue(source, ["transparency", "transparent"]),
  );
  if (transparency !== undefined) {
    const normalized = transparency > 1 ? transparency / 255 : transparency;
    return Math.max(0, Math.min(1, 1 - normalized));
  }
  return undefined;
}

function materialTextureName(source: string) {
  const candidates = [
    xmlTextValue(source, ["texture", "textureFile", "texture_file", "filename"]),
    ...[...source.matchAll(/(?:texture|filename)[^<>"']*["']([^"']+)["']/gi)].map(
      (match) => match[1],
    ),
  ].filter((value): value is string => Boolean(value));
  return candidates
    .map((value) => safeLeaf(value))
    .find((value) => /\.(?:png|jpe?g|webp|bmp|tiff?)$/i.test(value));
}

function materialDefinitionEntries(entries: readonly ZipEntry[]) {
  return entries.filter(
    (entry) =>
      /(?:^|\/)materials?(?:\/|$)/i.test(entry.name) &&
      /(?:material\.xml|\.material\.xml)$/i.test(entry.name),
  );
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

export async function extractSketchUpMaterialDefinitions(
  asset: Asset,
): Promise<{
  definitions: ExtractedSketchUpMaterialDefinition[];
  issues: string[];
}> {
  if (!/\.(skb|skp)$/i.test(asset.name))
    return {
      definitions: [],
      issues: ["Choose a SketchUp SKB/SKP archive first."],
    };

  const archive = new Uint8Array(await asset.blob.arrayBuffer());
  const parsed = parseZipEntries(archive);
  if (!parsed.zipLike)
    return { definitions: [], issues: parsed.issues };

  const entries = materialDefinitionEntries(parsed.entries).slice(0, 250);
  const definitions: ExtractedSketchUpMaterialDefinition[] = [];
  const issues = [...parsed.issues];

  for (const entry of entries) {
    if (entry.uncompressedSize > 512 * 1024) {
      issues.push(
        `SketchUp material definition is too large to inspect safely: ${entry.name}`,
      );
      continue;
    }
    try {
      const bytes = await extractEntry(archive, entry);
      const source = decoder.decode(bytes);
      const name = materialNameFromPath(entry.name);
      if (!name) {
        issues.push(
          `SketchUp material definition has no resolvable material folder: ${entry.name}`,
        );
        continue;
      }
      const textureName = materialTextureName(source);
      const baseColor = materialColor(source);
      const opacity = materialOpacity(source);
      const xScale = finiteValue(
        xmlTextValue(source, ["xScale", "xscale", "textureWidth"]),
      );
      const yScale = finiteValue(
        xmlTextValue(source, ["yScale", "yscale", "textureHeight"]),
      );
      definitions.push({
        archivePath: entry.name,
        name,
        ...(textureName ? { textureName } : {}),
        ...(baseColor ? { baseColor } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
        ...(xScale !== undefined && xScale > 0 ? { xScale } : {}),
        ...(yScale !== undefined && yScale > 0 ? { yScale } : {}),
      });
    } catch (error) {
      issues.push(
        error instanceof Error
          ? error.message
          : `Could not inspect SketchUp material definition: ${entry.name}`,
      );
    }
  }

  return { definitions, issues };
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


function printableAsciiRuns(bytes: Uint8Array, limit = 1200) {
  const values: string[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0 || end - start < 3) {
      start = -1;
      return;
    }
    const value = new TextDecoder("windows-1252")
      .decode(bytes.subarray(start, end))
      .replace(/\s+/g, " ")
      .replace(/[\u0080-\uFFFF].*$/, "")
      .trim();
    if (
      value.length >= 3 &&
      value.length <= 180 &&
      /[a-z]/i.test(value) &&
      !/^[0-9 .,:;_+-]+$/.test(value)
    )
      values.push(value);
    start = -1;
  };

  for (let index = 0; index <= bytes.length; index += 1) {
    const value = index < bytes.length ? bytes[index] : 0;
    const printable =
      (value >= 32 && value <= 126) || (value >= 160 && value <= 255);
    if (printable) {
      if (start < 0) start = index;
    } else {
      flush(index);
      if (values.length >= limit) break;
    }
  }
  return [...new Set(values)].slice(0, limit);
}

function semanticStrings(values: readonly string[]) {
  const architecture = /\b(?:wall|door|window|stair|lift|elevator|column|slab|roof|floor|room|living|kitchen|bed ?room|toilet|bath|balcony|duct|shaft|gate|parking|sidewalk|boundary|terrace|lobby|corridor)\b/i;
  const tagLike = /^(?:layer(?:[_ .-]*[a-z0-9_. -]+)?|tag\b|[a-z0-9_. -]*(?:wall|door|window|stair|lift|column|slab|floor|roof|duct|sidewalk|parking)[a-z0-9_. -]*)$/i;
  const componentLike = /(?:component|group|instance|block|door|window|stair|lift|furniture|plant|tree|car|gate)/i;

  const readableStrings = values
    .filter((value) => !value.startsWith("<"))
    .filter((value) => !/^[A-F0-9]{24,}$/i.test(value.replace(/[^A-F0-9]/gi, "")))
    .slice(0, 500);
  const searchable = (value: string) =>
    value.replace(/[_./:-]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    readableStrings,
    tagCandidates: readableStrings
      .filter((value) => tagLike.test(value))
      .slice(0, 180),
    componentCandidates: readableStrings
      .filter((value) => componentLike.test(searchable(value)))
      .slice(0, 180),
    architecturalTokens: readableStrings
      .filter((value) => architecture.test(searchable(value)))
      .slice(0, 220),
  };
}

export async function inspectSketchUpSemanticEvidence(
  asset: Asset,
): Promise<SketchUpSemanticEvidence> {
  const result: SketchUpSemanticEvidence = {
    modelDataFiles: [],
    readableStrings: [],
    tagCandidates: [],
    componentCandidates: [],
    architecturalTokens: [],
    issues: [],
  };
  if (!/\.(?:skb|skp)$/i.test(asset.name)) return result;

  const archive = new Uint8Array(await asset.blob.arrayBuffer());
  const parsed = parseZipEntries(archive);
  result.issues.push(...parsed.issues);
  if (!parsed.zipLike) return result;

  const modelEntries = parsed.entries
    .filter((entry) => /(?:^|\/)model\.dat$/i.test(entry.name))
    .slice(0, 4);
  result.modelDataFiles = modelEntries.map((entry) => entry.name);
  if (!modelEntries.length) {
    result.issues.push(
      "SketchUp archive contains no readable model.dat semantic evidence.",
    );
    return result;
  }

  const runs: string[] = [];
  let total = 0;
  for (const entry of modelEntries) {
    if (entry.uncompressedSize > 24 * 1024 * 1024) {
      result.issues.push(
        `SketchUp model data is too large for safe literal-semantic inspection: ${entry.name}`,
      );
      continue;
    }
    if (total + entry.uncompressedSize > 32 * 1024 * 1024) {
      result.issues.push(
        "SketchUp semantic inspection stopped at the 32 MB model-data safety limit.",
      );
      break;
    }
    try {
      const bytes = await extractEntry(archive, entry);
      total += bytes.byteLength;
      runs.push(...printableAsciiRuns(bytes));
    } catch (error) {
      result.issues.push(
        error instanceof Error
          ? error.message
          : `Could not inspect SketchUp model data: ${entry.name}`,
      );
    }
  }

  const semantic = semanticStrings([...new Set(runs)]);
  result.readableStrings = semantic.readableStrings;
  result.tagCandidates = semantic.tagCandidates;
  result.componentCandidates = semantic.componentCandidates;
  result.architecturalTokens = semantic.architecturalTokens;
  return result;
}

import type { Asset } from "./domain";

export interface DwgEvidenceInspection {
  versionCode?: string;
  versionLabel?: string;
  aecTokens: string[];
  drawingTextHints: string[];
  issues: string[];
}

const VERSION: Record<string, string> = {
  AC1012: "AutoCAD R13",
  AC1014: "AutoCAD R14",
  AC1015: "AutoCAD 2000/2000i/2002",
  AC1018: "AutoCAD 2004/2005/2006",
  AC1021: "AutoCAD 2007/2008/2009",
  AC1024: "AutoCAD 2010/2011/2012",
  AC1027: "AutoCAD 2013-2017",
  AC1032: "AutoCAD 2018+",
};

const ARCHITECTURAL_TERMS = [
  "AEC_WALL",
  "AEC_DOOR",
  "AEC_WINDOW",
  "AEC_STAIR",
  "AEC_SLAB",
  "AEC_ROOF",
  "WALL",
  "DOOR",
  "WINDOW",
  "STAIR",
  "SLAB",
  "COLUMN",
  "LIFT",
  "LOBBY",
  "KITCHEN",
  "BEDROOM",
  "LIVING",
  "TOILET",
  "BALCONY",
];

export async function inspectDwgEvidence(
  asset: Asset,
): Promise<DwgEvidenceInspection> {
  const result: DwgEvidenceInspection = {
    aecTokens: [],
    drawingTextHints: [],
    issues: [],
  };
  if (!/\.dwg$/i.test(asset.name)) return result;
  if (asset.size > 32 * 1024 * 1024) {
    result.issues.push(
      "DWG exceeds the safe lightweight evidence scan limit; controlled CAD decoding is required.",
    );
    return result;
  }

  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  const header = new TextDecoder("ascii")
    .decode(bytes.subarray(0, Math.min(16, bytes.length)))
    .replace(/[^A-Z0-9]/g, "");
  const code = header.match(/AC10\d{2}/)?.[0];
  if (code) {
    result.versionCode = code;
    result.versionLabel = VERSION[code] ?? "Recognized DWG version code";
  } else {
    result.issues.push("DWG version header was not recognized.");
  }

  const text = new TextDecoder("windows-1252", { fatal: false }).decode(bytes);
  const asciiRuns = text.match(/[\x20-\x7e]{4,}/g) ?? [];
  const upperRuns = asciiRuns.map((value) => value.trim()).filter(Boolean);
  const tokens = new Set<string>();
  for (const term of ARCHITECTURAL_TERMS) {
    const pattern = new RegExp(
      `(?:^|[^A-Z])${term.replace("_", "[_ -]?")}(?:$|[^A-Z])`,
      "i",
    );
    if (upperRuns.some((value) => pattern.test(value))) tokens.add(term);
  }
  result.aecTokens = [...tokens];

  const useful = upperRuns
    .filter(
      (value) =>
        /(?:FLOOR PLAN|STRUCTURAL|DIMENSION|BEDROOM|LIVING|KITCHEN|TOILET|BALCONY|LIFT|LOBBY|STAIR|COLUMN|SLAB|BEAM)/i.test(
          value,
        ) &&
        value.length <= 160,
    )
    .map((value) => value.replace(/\s+/g, " ").trim());

  result.drawingTextHints = [...new Set(useful)].slice(0, 100);
  return result;
}

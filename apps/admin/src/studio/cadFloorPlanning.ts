export interface CadFloorPlanAuditLike {
  name: string;
  textLabels?: Array<{ text: string }>;
  normalizedDwg?: {
    floors: Array<{ label: string; confidence: number }>;
    texts: Array<{ text: string; kind: string }>;
  };
}

export interface CadFloorPlanRole {
  auditIndex: number;
  level: number;
  label: string;
  elevation: number;
  explicit: boolean;
}

const WORD_LEVELS: Array<[RegExp, number]> = [
  [/\bfirst\s+floor\b/i, 1],
  [/\bsecond\s+floor\b/i, 2],
  [/\bthird\s+floor\b/i, 3],
  [/\bfourth\s+floor\b/i, 4],
  [/\bfifth\s+floor\b/i, 5],
  [/\bsixth\s+floor\b/i, 6],
  [/\bseventh\s+floor\b/i, 7],
  [/\beighth\s+floor\b/i, 8],
  [/\bninth\s+floor\b/i, 9],
  [/\btenth\s+floor\b/i, 10],
];

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[_/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cadFloorLevels(value: string) {
  const text = normalized(value);
  const levels = new Set<number>();
  if (!text) return [];

  if (/\b(?:ground\s+floor|ground|g\s*floor|gf)\b/.test(text)) levels.add(0);

  for (const [pattern, level] of WORD_LEVELS)
    if (pattern.test(text)) levels.add(level);

  for (const match of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+floor\b/g))
    levels.add(Number(match[1]));
  for (const match of text.matchAll(/\bfloor\s+(\d{1,2})\b/g))
    levels.add(Number(match[1]));

  for (const match of text.matchAll(/\bb(?:asement)?\s*([1-9]\d?)\b/g))
    levels.add(-Number(match[1]));
  for (const match of text.matchAll(/\bbasement\s+(\d{1,2})\b/g))
    levels.add(-Number(match[1]));
  if (/\bbasement\b/.test(text) && ![...levels].some((level) => level < 0))
    levels.add(-1);

  return [...levels].filter(Number.isFinite).sort((a, b) => a - b);
}

function auditFloorLevels(audit: CadFloorPlanAuditLike) {
  const values = [
    audit.name,
    ...(audit.normalizedDwg?.floors ?? [])
      .filter((floor) => floor.confidence >= 0.7)
      .map((floor) => floor.label),
    ...(audit.normalizedDwg?.texts ?? [])
      .filter((entry) => entry.kind === "floor")
      .map((entry) => entry.text),
    ...(audit.textLabels ?? [])
      .map((entry) => entry.text)
      .filter((text) => /\b(?:floor|ground|basement|\bgf\b|\bb\d+\b)/i.test(text)),
  ];
  return [...new Set(values.flatMap(cadFloorLevels))].sort((a, b) => a - b);
}

function floorLabel(level: number) {
  if (level === 0) return "Ground";
  if (level < 0) return `Basement ${Math.abs(level)}`;
  return `Floor ${level}`;
}

export function resolveCadFloorPlanRoles(
  audits: readonly CadFloorPlanAuditLike[],
  floorSpacingM = 3,
): { roles: CadFloorPlanRole[]; issues: string[] } {
  if (!audits.length) return { roles: [], issues: [] };
  if (!(floorSpacingM >= 2 && floorSpacingM <= 8))
    throw Error("CAD floor spacing must be between 2 m and 8 m.");

  const levelsByAudit = audits.map(auditFloorLevels);
  if (audits.length === 1 && levelsByAudit[0].length === 0)
    return {
      roles: [
        {
          auditIndex: 0,
          level: 0,
          label: "CAD Plan",
          elevation: 0,
          explicit: false,
        },
      ],
      issues: [
        "CAD floor identity is not explicit; the single source is treated as one reviewable plan at elevation 0 m.",
      ],
    };

  for (let index = 0; index < levelsByAudit.length; index += 1) {
    const levels = levelsByAudit[index];
    if (!levels.length)
      throw Error(
        `CAD source “${audits[index].name}” has no unambiguous floor identity. Name or label each floor source explicitly before multi-floor AutoBuild.`,
      );
    if (levels.length > 1)
      throw Error(
        `CAD source “${audits[index].name}” contains multiple floor identities (${levels.map(floorLabel).join(", ")}). Rekixo will not guess which geometry belongs to which floor.`,
      );
  }

  const seen = new Map<number, number>();
  for (let index = 0; index < levelsByAudit.length; index += 1) {
    const level = levelsByAudit[index][0];
    const previous = seen.get(level);
    if (previous !== undefined)
      throw Error(
        `Multiple CAD sources resolve to ${floorLabel(level)} (“${audits[previous].name}” and “${audits[index].name}”). Resolve the duplicate floor role before AutoBuild.`,
      );
    seen.set(level, index);
  }

  const roles = levelsByAudit
    .map((levels, auditIndex) => {
      const level = levels[0];
      return {
        auditIndex,
        level,
        label: floorLabel(level),
        elevation: Number((level * floorSpacingM).toFixed(4)),
        explicit: true,
      } satisfies CadFloorPlanRole;
    })
    .sort((left, right) => left.level - right.level);

  return {
    roles,
    issues:
      roles.length > 1
        ? [
            `Floor elevations are inferred at ${floorSpacingM.toFixed(1)} m spacing from explicit CAD floor identities; review elevations before publishing.`,
          ]
        : [],
  };
}

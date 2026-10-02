import type { SmartProjectAnalysis } from "./projectAnalyzer";

export interface RepeatedFloorMember {
  floorIndex: number;
  similarity: number;
}

export interface RepeatedFloorGroup {
  sourceFloorIndex: number;
  members: RepeatedFloorMember[];
  confidence: number;
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/[^a-z#]+/g, " ")
    .trim();
}

function multiset(values: readonly string[]) {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

function multisetScore(a: Map<string, number>, b: Map<string, number>) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let common = 0;
  let total = 0;
  for (const key of keys) {
    const left = a.get(key) ?? 0;
    const right = b.get(key) ?? 0;
    common += Math.min(left, right);
    total += Math.max(left, right);
  }
  return total ? common / total : 1;
}

function quantize(value: number, step = 0.05) {
  return Math.round(value / step) * step;
}

function architectureSignature(
  analysis: SmartProjectAnalysis,
  floorIndex: number,
) {
  return analysis.architecturalCandidates
    .filter((candidate) => candidate.floorIndex === floorIndex)
    .map((candidate) => {
      const [x, y, z] = candidate.size.map((value) => quantize(value));
      const dims = [x, y, z].sort((a, b) => a - b);
      return `${candidate.kind}:${dims.map((value) => value.toFixed(2)).join("x")}`;
    })
    .sort();
}

function nodeSignature(
  analysis: SmartProjectAnalysis,
  floorIndex: number,
) {
  return analysis.nodeAssignments
    .filter((assignment) => assignment.floorIndex === floorIndex)
    .map((assignment) => normalizeName(assignment.nodeName))
    .filter(Boolean)
    .sort();
}

export function repeatedFloorSimilarity(
  analysis: SmartProjectAnalysis,
  leftFloorIndex: number,
  rightFloorIndex: number,
) {
  const leftNodes = nodeSignature(analysis, leftFloorIndex);
  const rightNodes = nodeSignature(analysis, rightFloorIndex);
  const leftArch = architectureSignature(analysis, leftFloorIndex);
  const rightArch = architectureSignature(analysis, rightFloorIndex);

  const nodeScore = multisetScore(multiset(leftNodes), multiset(rightNodes));
  const archScore = multisetScore(multiset(leftArch), multiset(rightArch));
  const countScore =
    Math.max(leftNodes.length, rightNodes.length) > 0
      ? Math.min(leftNodes.length, rightNodes.length) /
        Math.max(leftNodes.length, rightNodes.length)
      : 1;

  const architectureWeight =
    leftArch.length || rightArch.length ? 0.3 : 0.1;
  const nodeWeight = 0.65;
  const countWeight = 1 - architectureWeight - nodeWeight;
  return Number(
    (
      nodeScore * nodeWeight +
      archScore * architectureWeight +
      countScore * countWeight
    ).toFixed(4),
  );
}

export function detectRepeatedFloors(
  analysis: SmartProjectAnalysis,
  threshold = 0.86,
): RepeatedFloorGroup[] {
  const count = analysis.floorCandidates.length;
  if (count < 2) return [];

  const consumed = new Set<number>();
  const groups: RepeatedFloorGroup[] = [];

  for (let source = 0; source < count; source += 1) {
    if (consumed.has(source)) continue;
    const members: RepeatedFloorMember[] = [];
    for (let target = source + 1; target < count; target += 1) {
      if (consumed.has(target)) continue;
      const similarity = repeatedFloorSimilarity(analysis, source, target);
      if (similarity >= threshold) members.push({ floorIndex: target, similarity });
    }
    if (!members.length) continue;

    consumed.add(source);
    for (const member of members) consumed.add(member.floorIndex);
    groups.push({
      sourceFloorIndex: source,
      members,
      confidence: Number(
        (
          members.reduce((sum, item) => sum + item.similarity, 0) /
          members.length
        ).toFixed(4),
      ),
    });
  }

  return groups;
}

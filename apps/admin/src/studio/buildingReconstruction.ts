import {
  roomArea,
  roomContainsPoint,
  type Floor,
  type Room,
  type Scene,
  type VerticalConnector,
} from "./domain";
import type { PdfPlanPageEvidence } from "./pdfPlanInspector";
import type {
  SmartArchitecturalCandidate,
  SmartCadAudit,
  SmartProjectAnalysis,
} from "./projectAnalyzer";
import {
  applyPdfCadPoint,
  estimatePdfCadRegistration,
} from "./crossSourceFusion";
import {
  applyCadRegistrationPoint,
  estimateCadModelRegistration,
} from "./sourceRegistration";
import { resolveCadFloorIndex } from "./architectureGraph";

export interface BuildingReconstructionSummary {
  unitsDetected: number;
  roomsAssignedToUnits: number;
  verticalConnectors: number;
  stairConnectors: number;
  liftConnectors: number;
  modelBoundConnectors: number;
}

export interface BuildingReconstructionResult {
  scene: Scene;
  summary: BuildingReconstructionSummary;
  issues: string[];
}

interface UnitSeed {
  label: string;
  floorId: string;
  point: [number, number];
  confidence: number;
  sourceAssetId: string;
  basis: "dwg" | "pdf";
}

function cleanUnitLabel(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (
    !text ||
    /\b(?:to|through)\b/i.test(text) ||
    /(?:\d)\s*[-–]\s*(?:\d)/.test(text)
  )
    return undefined;
  const match = text.match(
    /\b(flat|unit|apartment|apt)\s*(?:no\.?\s*)?([a-z0-9][a-z0-9-]{0,20})\b/i,
  );
  if (!match) return undefined;
  const prefix =
    match[1].toLowerCase() === "unit"
      ? "Unit"
      : match[1].toLowerCase().startsWith("apt") ||
          match[1].toLowerCase() === "apartment"
        ? "Apartment"
        : "Flat";
  return \`\${prefix} \${match[2].toUpperCase()}\`;
}

function placeholderUnit(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "auto" ||
    normalized === "auto draft" ||
    normalized === "unassigned" ||
    normalized === "unknown"
  );
}

function worldModelPoint(
  x: number,
  z: number,
  scene: Scene,
): [number, number] {
  const scale = scene.scale;
  const radians = ((scene.modelTransform?.rotationY ?? 0) * Math.PI) / 180;
  const sx = x * scale;
  const sz = z * scale;
  return [
    Number(
      (
        sx * Math.cos(radians) -
        sz * Math.sin(radians) +
        (scene.modelTransform?.x ?? 0)
      ).toFixed(5),
    ),
    Number(
      (
        sx * Math.sin(radians) +
        sz * Math.cos(radians) +
        (scene.modelTransform?.z ?? 0)
      ).toFixed(5),
    ),
  ];
}

function floorForModelCandidate(
  candidate: SmartArchitecturalCandidate,
  analysis: SmartProjectAnalysis,
  scene: Scene,
) {
  if (candidate.floorIndex === undefined) return undefined;
  const sourceFloor = analysis.floorCandidates[candidate.floorIndex];
  if (!sourceFloor) return undefined;
  const elevation =
    sourceFloor.elevation * scene.scale + (scene.modelTransform?.y ?? 0);
  return [...scene.floors].sort(
    (left, right) =>
      Math.abs(left.elevation - elevation) -
      Math.abs(right.elevation - elevation),
  )[0];
}

function floorsCoveredByCandidate(
  candidate: SmartArchitecturalCandidate,
  analysis: SmartProjectAnalysis,
  scene: Scene,
) {
  const direct = floorForModelCandidate(candidate, analysis, scene);
  if (direct) return [direct.id];

  const modelY = scene.modelTransform?.y ?? 0;
  const minY =
    (candidate.position[1] - candidate.size[1] / 2) * scene.scale + modelY;
  const maxY =
    (candidate.position[1] + candidate.size[1] / 2) * scene.scale + modelY;
  const covered = scene.floors
    .filter(
      (floor) =>
        floor.elevation >= minY - 0.6 &&
        floor.elevation <= maxY + 0.6,
    )
    .map((floor) => floor.id);
  return covered.length ? covered : scene.floors.map((floor) => floor.id);
}

function repeatedFamily(floors: readonly Floor[], sourceFloorId: string) {
  const source = floors.find((floor) => floor.id === sourceFloorId);
  if (!source) return [sourceFloorId];
  const rootId = source.repeatOfFloorId ?? source.id;
  const ids = new Set([source.id, rootId]);
  for (const floor of floors) {
    if (
      (floor.id === rootId || floor.repeatOfFloorId === rootId) &&
      (floor.id === source.id ||
        floor.repeatReviewed === true ||
        (floor.repeatConfidence ?? 0) >= 0.92)
    )
      ids.add(floor.id);
  }
  return [...ids].filter((id) =>
    floors.some((floor) => floor.id === id),
  );
}

function cadRegistrationForAudit(
  analysis: SmartProjectAnalysis,
  audit: SmartCadAudit,
  scene: Scene,
) {
  const floorIndex = resolveCadFloorIndex(audit, scene.floors.length);
  if (floorIndex === undefined || !scene.floors[floorIndex])
    return undefined;
  const registration = estimateCadModelRegistration(
    analysis,
    audit,
    floorIndex,
    scene.scale,
    scene.modelTransform,
  );
  if (!registration.compatible) return undefined;
  return { floorIndex, registration };
}

function roomDistance(room: Room, point: [number, number]) {
  return Math.hypot(room.x - point[0], room.z - point[1]);
}

function assignUnitSeeds(
  rooms: readonly Room[],
  seeds: readonly UnitSeed[],
) {
  const next = rooms.map((room) => ({ ...room }));
  let assigned = 0;

  for (const floorId of new Set(seeds.map((seed) => seed.floorId))) {
    const floorSeeds = seeds.filter((seed) => seed.floorId === floorId);
    const floorRooms = next.filter((room) => room.floorId === floorId);
    if (!floorSeeds.length || !floorRooms.length) continue;

    for (const room of floorRooms) {
      if (!placeholderUnit(room.unit)) continue;
      const containing = floorSeeds.filter((seed) =>
        roomContainsPoint(room, seed.point[0], seed.point[1], 0),
      );
      let selected: UnitSeed | undefined;

      if (containing.length === 1) selected = containing[0];
      else if (containing.length === 0 && floorSeeds.length >= 2) {
        const ranked = floorSeeds
          .map((seed) => ({
            seed,
            distance: roomDistance(room, seed.point),
          }))
          .sort((left, right) => left.distance - right.distance);
        const best = ranked[0];
        const second = ranked[1];
        const radius = Math.max(
          3,
          Math.min(12, Math.sqrt(Math.max(1, roomArea(room))) * 3.5),
        );
        if (
          best &&
          second &&
          best.distance <= radius &&
          best.distance <= second.distance * 0.78
        )
          selected = best.seed;
      }

      if (!selected) continue;
      room.unit = selected.label;
      room.source = [
        room.source.trim(),
        \`\${selected.label} suggested from registered \${selected.basis.toUpperCase()} spatial evidence (\${selected.confidence.toFixed(2)} confidence).\`,
      ]
        .filter(Boolean)
        .join(" ");
      room.verified = false;
      room.sourceAssetId ??= selected.sourceAssetId;
      assigned += 1;
    }
  }

  return { rooms: next, assigned };
}

function unitSeedsFromCad(
  analysis: SmartProjectAnalysis,
  scene: Scene,
) {
  const seeds: UnitSeed[] = [];
  for (const audit of analysis.cadAudits) {
    if (audit.kind !== "dwg" || !audit.normalizedDwg) continue;
    const aligned = cadRegistrationForAudit(analysis, audit, scene);
    if (!aligned) continue;
    const floor = scene.floors[aligned.floorIndex];
    if (!floor) continue;

    for (const entry of audit.normalizedDwg.texts) {
      const label = cleanUnitLabel(entry.text);
      if (!label) continue;
      const point = applyCadRegistrationPoint(
        entry.point,
        aligned.registration.sourceCentre,
        aligned.registration.targetCentre,
        aligned.registration.rotationDeg,
      );
      seeds.push({
        label,
        floorId: floor.id,
        point,
        confidence: Number(
          Math.min(0.96, 0.9 * aligned.registration.confidence).toFixed(3),
        ),
        sourceAssetId: audit.assetId,
        basis: "dwg",
      });
    }
  }
  return seeds;
}

function unitSeedsFromPdf(
  analysis: SmartProjectAnalysis,
  scene: Scene,
  page: PdfPlanPageEvidence | undefined,
  pdfAssetId: string | undefined,
) {
  if (!page || !pdfAssetId) return [] as UnitSeed[];
  const unitLabels = page.spatialLabels.filter(
    (entry) => entry.kind === "unit" && Boolean(cleanUnitLabel(entry.text)),
  );
  if (!unitLabels.length) return [] as UnitSeed[];

  for (const audit of analysis.cadAudits) {
    if (audit.kind !== "dwg" || !audit.normalizedDwg) continue;
    const cad = cadRegistrationForAudit(analysis, audit, scene);
    if (!cad) continue;
    const pdf = estimatePdfCadRegistration(page, audit);
    if (!pdf.compatible) continue;
    const floor = scene.floors[cad.floorIndex];
    if (!floor) continue;

    return unitLabels.flatMap((entry): UnitSeed[] => {
      const label = cleanUnitLabel(entry.text);
      if (!label) return [];
      const cadPoint = applyPdfCadPoint(
        [entry.x * page.aspectRatio, entry.y],
        pdf,
      );
      if (!cadPoint) return [];
      const point = applyCadRegistrationPoint(
        cadPoint,
        cad.registration.sourceCentre,
        cad.registration.targetCentre,
        cad.registration.rotationDeg,
      );
      return [
        {
          label,
          floorId: floor.id,
          point,
          confidence: Number(
            Math.min(
              0.96,
              pdf.confidence * cad.registration.confidence,
            ).toFixed(3),
          ),
          sourceAssetId: pdfAssetId,
          basis: "pdf",
        },
      ];
    });
  }

  return [] as UnitSeed[];
}

function connectorPointFromCadObject(
  value:
    | {
        point?: [number, number];
        bounds?: {
          min: [number, number];
          max: [number, number];
        };
      }
    | undefined,
) {
  if (!value) return undefined;
  if (value.point) return value.point;
  if (value.bounds)
    return [
      (value.bounds.min[0] + value.bounds.max[0]) / 2,
      (value.bounds.min[1] + value.bounds.max[1]) / 2,
    ] as [number, number];
  return undefined;
}

function modelConnectorCandidates(
  analysis: SmartProjectAnalysis,
  scene: Scene,
): VerticalConnector[] {
  return analysis.architecturalCandidates.flatMap((candidate, index) => {
    if (candidate.kind !== "stair" && candidate.kind !== "lift") return [];
    const point = worldModelPoint(
      candidate.position[0],
      candidate.position[2],
      scene,
    );
    const floorIds = floorsCoveredByCandidate(candidate, analysis, scene);
    if (!floorIds.length) return [];
    const confidence = Number(candidate.confidence.toFixed(3));
    return [
      {
        id: \`connector-model-\${candidate.kind}-\${index + 1}\`,
        kind: candidate.kind,
        origin: "model-auto",
        floorIds,
        x: point[0],
        z: point[1],
        reviewed: false,
        reviewState: confidence >= 0.92 ? "auto_ready" : "suggested",
        confidence,
        sourceNodeName: candidate.nodeName,
        sourceOccurrence: candidate.occurrence,
      } satisfies VerticalConnector,
    ];
  });
}

function cadConnectorCandidates(
  analysis: SmartProjectAnalysis,
  scene: Scene,
): VerticalConnector[] {
  const result: VerticalConnector[] = [];

  for (const audit of analysis.cadAudits) {
    if (audit.kind !== "dwg" || !audit.normalizedDwg) continue;
    const aligned = cadRegistrationForAudit(analysis, audit, scene);
    if (!aligned) continue;
    const floor = scene.floors[aligned.floorIndex];
    if (!floor) continue;

    const values = [
      ...audit.normalizedDwg.inserts.map((entry) => ({
        kind: entry.kind,
        confidence: entry.confidence,
        sourceEntity: entry.name || "INSERT",
        point: entry.point,
      })),
      ...audit.normalizedDwg.objects.map((entry) => ({
        kind: entry.kind,
        confidence: entry.confidence,
        sourceEntity: entry.sourceEntity,
        point: connectorPointFromCadObject(entry),
      })),
    ];

    for (const [index, entry] of values.entries()) {
      if (
        (entry.kind !== "stair" && entry.kind !== "lift") ||
        !entry.point
      )
        continue;
      const point = applyCadRegistrationPoint(
        entry.point,
        aligned.registration.sourceCentre,
        aligned.registration.targetCentre,
        aligned.registration.rotationDeg,
      );
      const floorIds = repeatedFamily(scene.floors, floor.id);
      const repeatPenalty = floorIds.length > 1 ? 0.96 : 1;
      const confidence = Number(
        Math.min(
          0.98,
          entry.confidence *
            aligned.registration.confidence *
            repeatPenalty,
        ).toFixed(3),
      );
      result.push({
        id: \`connector-cad-\${audit.assetId.slice(0, 10)}-\${index + 1}\`,
        kind: entry.kind,
        origin: "cad-auto",
        floorIds,
        x: point[0],
        z: point[1],
        reviewed: false,
        reviewState:
          confidence >= 0.9 && !aligned.registration.ambiguous
            ? "auto_ready"
            : "suggested",
        confidence,
        sourceAssetId: audit.assetId,
        sourceEntity: entry.sourceEntity,
      });
    }
  }

  return result;
}

function bindAndFuseConnectors(
  cad: readonly VerticalConnector[],
  model: readonly VerticalConnector[],
) {
  const usedModel = new Set<string>();
  const result: VerticalConnector[] = cad.map((connector) => {
    const nearest = model
      .filter(
        (candidate) =>
          candidate.kind === connector.kind &&
          !usedModel.has(candidate.id),
      )
      .map((candidate) => ({
        candidate,
        distance: Math.hypot(
          candidate.x - connector.x,
          candidate.z - connector.z,
        ),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest || nearest.distance > 2.5) return { ...connector };
    usedModel.add(nearest.candidate.id);
    return {
      ...connector,
      floorIds: [
        ...new Set([
          ...connector.floorIds,
          ...nearest.candidate.floorIds,
        ]),
      ],
      confidence: Number(
        Math.min(
          connector.confidence ?? 0,
          nearest.candidate.confidence ?? 0,
        ).toFixed(3),
      ),
      sourceNodeName: nearest.candidate.sourceNodeName,
      sourceOccurrence: nearest.candidate.sourceOccurrence,
    };
  });

  result.push(
    ...model
      .filter((candidate) => !usedModel.has(candidate.id))
      .map((candidate) => ({ ...candidate })),
  );

  const deduped: VerticalConnector[] = [];
  for (const candidate of result.sort(
    (left, right) =>
      Number(right.origin === "cad-auto") -
        Number(left.origin === "cad-auto") ||
      (right.confidence ?? 0) - (left.confidence ?? 0),
  )) {
    const existing = deduped.find(
      (entry) =>
        entry.kind === candidate.kind &&
        Math.hypot(entry.x - candidate.x, entry.z - candidate.z) <= 0.6,
    );
    if (!existing) {
      deduped.push({
        ...candidate,
        floorIds: [...candidate.floorIds],
      });
      continue;
    }
    existing.floorIds = [
      ...new Set([...existing.floorIds, ...candidate.floorIds]),
    ];
    if (!existing.sourceNodeName && candidate.sourceNodeName) {
      existing.sourceNodeName = candidate.sourceNodeName;
      existing.sourceOccurrence = candidate.sourceOccurrence;
    }
  }

  return deduped;
}

export function reconstructBuildingSemantics(
  scene: Scene,
  analysis: SmartProjectAnalysis,
  options: {
    pdfPlanEvidence?: PdfPlanPageEvidence;
    pdfAssetId?: string;
  } = {},
): BuildingReconstructionResult {
  const issues: string[] = [];
  const cadSeeds = unitSeedsFromCad(analysis, scene);
  const pdfSeeds = unitSeedsFromPdf(
    analysis,
    scene,
    options.pdfPlanEvidence,
    options.pdfAssetId,
  );
  const seedByKey = new Map<string, UnitSeed>();
  for (const seed of [...cadSeeds, ...pdfSeeds]) {
    const key = \`\${seed.floorId}\\u0000\${seed.label.toLowerCase()}\\u0000\${Math.round(seed.point[0] * 10)}:\${Math.round(seed.point[1] * 10)}\`;
    const existing = seedByKey.get(key);
    if (!existing || seed.confidence > existing.confidence)
      seedByKey.set(key, seed);
  }
  const seeds = [...seedByKey.values()];
  const assigned = assignUnitSeeds(scene.rooms, seeds);

  const generatedConnectors = bindAndFuseConnectors(
    cadConnectorCandidates(analysis, scene),
    modelConnectorCandidates(analysis, scene),
  );
  const retainedConnectors = (scene.verticalConnectors ?? []).filter(
    (connector) => connector.reviewed || connector.origin === "manual",
  );
  const connectorIds = new Set(
    retainedConnectors.map((connector) => connector.id),
  );
  const verticalConnectors = [
    ...retainedConnectors.map((connector) => ({
      ...connector,
      floorIds: [...connector.floorIds],
    })),
    ...generatedConnectors.filter(
      (connector) => !connectorIds.has(connector.id),
    ),
  ];

  if (
    analysis.cadAudits.some(
      (audit) => audit.kind === "dwg" && audit.normalizedDwg,
    ) &&
    !generatedConnectors.some((connector) => connector.origin === "cad-auto")
  )
    issues.push(
      "Normalized DWG contained no safely registerable stair/lift connector positions; no connector geometry was invented.",
    );

  const unitsDetected = new Set(
    assigned.rooms
      .map((room) => room.unit.trim())
      .filter((unit) => !placeholderUnit(unit)),
  ).size;

  return {
    scene: {
      ...scene,
      rooms: assigned.rooms,
      verticalConnectors,
    },
    summary: {
      unitsDetected,
      roomsAssignedToUnits: assigned.assigned,
      verticalConnectors: verticalConnectors.length,
      stairConnectors: verticalConnectors.filter(
        (connector) => connector.kind === "stair",
      ).length,
      liftConnectors: verticalConnectors.filter(
        (connector) => connector.kind === "lift",
      ).length,
      modelBoundConnectors: verticalConnectors.filter(
        (connector) => Boolean(connector.sourceNodeName),
      ).length,
    },
    issues,
  };
}

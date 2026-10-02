import type { Room, RoomPoint, Scene } from "./domain";
import type { OpeningSuggestion } from "./openingAssociator";
import type { SmartCadAudit } from "./projectAnalyzer";
import type { CadModelRegistration } from "./sourceRegistration";

export interface CadOpeningFusionResult {
  suggestions: OpeningSuggestion[];
  cadEvidence: number;
  matched: number;
  cadOnlyReview: number;
}

function rotate(point: RoomPoint, degrees: number): RoomPoint {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    point[0] * cos - point[1] * sin,
    point[0] * sin + point[1] * cos,
  ];
}

function registeredPoint(
  point: RoomPoint,
  registration: CadModelRegistration,
): RoomPoint {
  const local: RoomPoint = [
    point[0] - registration.sourceCentre[0],
    point[1] - registration.sourceCentre[1],
  ];
  const rotated = rotate(local, registration.rotationDeg);
  return [
    Number((registration.targetCentre[0] + rotated[0]).toFixed(4)),
    Number((registration.targetCentre[1] + rotated[1]).toFixed(4)),
  ];
}

function boundary(room: Room): RoomPoint[] {
  if (room.polygon?.length)
    return room.polygon.map((point) => [point[0], point[1]]);
  return [
    [room.x - room.width / 2, room.z - room.depth / 2],
    [room.x + room.width / 2, room.z - room.depth / 2],
    [room.x + room.width / 2, room.z + room.depth / 2],
    [room.x - room.width / 2, room.z + room.depth / 2],
  ];
}

function closestOnSegment(
  point: RoomPoint,
  start: RoomPoint,
  end: RoomPoint,
) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) /
              lengthSquared,
          ),
        )
      : 0;
  const closest: RoomPoint = [start[0] + t * dx, start[1] + t * dz];
  const length = Math.hypot(dx, dz) || 1;
  return {
    point: closest,
    distance: Math.hypot(point[0] - closest[0], point[1] - closest[1]),
    direction: [dx / length, dz / length] as RoomPoint,
  };
}

function nearestRoomWalls(
  scene: Scene,
  floorId: string,
  point: RoomPoint,
) {
  return scene.rooms
    .filter((room) => room.floorId === floorId)
    .flatMap((room) => {
      const points = boundary(room);
      let best:
        | {
            room: Room;
            point: RoomPoint;
            distance: number;
            direction: RoomPoint;
          }
        | undefined;
      for (let index = 0; index < points.length; index += 1) {
        const hit = closestOnSegment(
          point,
          points[index],
          points[(index + 1) % points.length],
        );
        if (!best || hit.distance < best.distance)
          best = { room, ...hit };
      }
      return best ? [best] : [];
    })
    .sort((left, right) => left.distance - right.distance);
}

function openingWidthPlausible(kind: "door" | "window", width: number) {
  return kind === "door"
    ? width >= 0.45 && width <= 3.5
    : width >= 0.25 && width <= 8;
}

function orientationDifference(left: number, right: number) {
  const normalized = Math.abs((((left - right) % 180) + 180) % 180);
  return Math.min(normalized, 180 - normalized);
}

function sameRoomEvidence(left: readonly string[], right: readonly string[]) {
  if (!left.length || !right.length) return false;
  const set = new Set(left);
  return right.some((id) => set.has(id));
}

function cadSuggestions(
  audit: SmartCadAudit,
  floorId: string,
  floorElevation: number,
  scene: Scene,
  registration: CadModelRegistration,
): OpeningSuggestion[] {
  if (
    !registration.compatible ||
    registration.ambiguous ||
    registration.confidence < 0.68
  )
    return [];

  const result: OpeningSuggestion[] = [];
  let occurrence = 0;
  for (const segment of audit.semanticSegments ?? []) {
    if (segment.kind !== "door" && segment.kind !== "window") continue;
    occurrence += 1;

    const start = registeredPoint(segment.start, registration);
    const end = registeredPoint(segment.end, registration);
    const midpoint: RoomPoint = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
    ];
    const planWidth = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const widthPlausible = openingWidthPlausible(segment.kind, planWidth);
    const hits = nearestRoomWalls(scene, floorId, midpoint);
    const best = hits[0];
    const maxWallDistance = segment.kind === "door" ? 0.55 : 0.7;
    const roomIds: string[] = [];

    if (best && best.distance <= maxWallDistance) {
      roomIds.push(best.room.id);
      if (segment.kind === "door") {
        const second = hits.find((hit) => {
          if (hit.room.id === best.room.id) return false;
          if (hit.distance > Math.min(maxWallDistance, best.distance + 0.12))
            return false;
          const anchorDistance = Math.hypot(
            hit.point[0] - best.point[0],
            hit.point[1] - best.point[1],
          );
          const parallel = Math.abs(
            hit.direction[0] * best.direction[0] +
              hit.direction[1] * best.direction[1],
          );
          return anchorDistance <= 0.45 && parallel >= 0.92;
        });
        if (second) roomIds.push(second.room.id);
      }
    }

    const segmentConfidence = segment.confidence ?? 0.7;
    const confidence = Number(
      Math.max(
        0.1,
        Math.min(
          0.96,
          segmentConfidence *
            (0.62 + registration.confidence * 0.38) *
            (widthPlausible ? 1 : 0.72) *
            (roomIds.length ? 1 : 0.72),
        ),
      ).toFixed(3),
    );
    const sourceNodeName = (
      "CAD:" + audit.assetId + ":" + (segment.id ?? occurrence)
    )
      .replace(/\s+/g, " ")
      .slice(0, 480);
    const wallPoint = best?.point ?? midpoint;
    const rotationY = best
      ? Number(
          (
            (Math.atan2(-best.direction[1], best.direction[0]) * 180) /
            Math.PI
          ).toFixed(3),
        )
      : Number(
          (
            (Math.atan2(-(end[1] - start[1]), end[0] - start[0]) * 180) /
            Math.PI
          ).toFixed(3),
        );
    const fallbackWidth = segment.kind === "door" ? 0.9 : 1.2;
    const verticalCentre =
      floorElevation + (segment.kind === "door" ? 1.05 : 1.5);

    result.push({
      key: sourceNodeName + "\u0000" + occurrence,
      sourceNodeName,
      sourceOccurrence: occurrence,
      kind: segment.kind,
      floorId,
      roomIds,
      position: [
        Number(wallPoint[0].toFixed(4)),
        Number(verticalCentre.toFixed(4)),
        Number(wallPoint[1].toFixed(4)),
      ],
      width: Number((widthPlausible ? planWidth : fallbackWidth).toFixed(3)),
      height: segment.kind === "door" ? 2.1 : 1.2,
      ...(segment.kind === "window" ? { sillHeight: 0.9 } : {}),
      rotationY,
      wallDistance: Number(
        Number.isFinite(best?.distance)
          ? (best?.distance ?? 0).toFixed(3)
          : 9999,
      ),
      confidence,
      ready: false,
      reasons: [
        "normalized " +
          audit.kind.toUpperCase() +
          " " +
          segment.kind +
          " plan evidence",
        "CAD/model registration confidence " +
          registration.confidence.toFixed(2),
        widthPlausible
          ? "plan opening width " + planWidth.toFixed(2) + " m"
          : "plan segment width is not dimension-safe",
        roomIds.length
          ? "matched " +
            roomIds.length +
            " reconstructed room wall" +
            (roomIds.length === 1 ? "" : "s")
          : "no reconstructed room wall match",
        "vertical opening dimensions require 3D corroboration before auto-ready",
      ],
    });
  }
  return result;
}

function dedupeCadEvidence(values: readonly OpeningSuggestion[]) {
  const byKey = new Map<string, OpeningSuggestion>();
  for (const value of values) {
    const key = [
      value.kind,
      value.floorId ?? "",
      Math.round(value.position[0] * 10),
      Math.round(value.position[2] * 10),
      Math.round(value.width * 10),
    ].join(":");
    const current = byKey.get(key);
    if (!current || value.confidence > current.confidence)
      byKey.set(key, value);
  }
  return [...byKey.values()];
}

export function fuseCadOpeningEvidence(
  modelSuggestions: readonly OpeningSuggestion[],
  audit: SmartCadAudit,
  floorId: string,
  floorElevation: number,
  scene: Scene,
  registration: CadModelRegistration,
): CadOpeningFusionResult {
  const cad = dedupeCadEvidence(
    cadSuggestions(audit, floorId, floorElevation, scene, registration),
  );
  if (!cad.length)
    return {
      suggestions: [...modelSuggestions],
      cadEvidence: 0,
      matched: 0,
      cadOnlyReview: 0,
    };

  const usedCad = new Set<number>();
  const suggestions = modelSuggestions.map((model) => {
    if (!model.floorId || model.floorId !== floorId) return { ...model };

    let best:
      | {
          index: number;
          suggestion: OpeningSuggestion;
          score: number;
        }
      | undefined;

    for (let index = 0; index < cad.length; index += 1) {
      if (usedCad.has(index)) continue;
      const candidate = cad[index];
      if (
        candidate.kind !== model.kind ||
        candidate.floorId !== model.floorId
      )
        continue;

      const distance = Math.hypot(
        candidate.position[0] - model.position[0],
        candidate.position[2] - model.position[2],
      );
      const threshold = Math.max(
        0.45,
        Math.min(1.4, (candidate.width + model.width) * 0.55),
      );
      if (distance > threshold) continue;

      const orientation = orientationDifference(
        candidate.rotationY,
        model.rotationY,
      );
      const roomAgreement = sameRoomEvidence(
        candidate.roomIds,
        model.roomIds,
      );
      if (orientation > 35 && !roomAgreement) continue;

      const widthDelta =
        Math.abs(candidate.width - model.width) /
        Math.max(0.25, candidate.width, model.width);
      const score =
        distance / threshold +
        orientation / 90 +
        Math.min(1, widthDelta) * 0.45 -
        (roomAgreement ? 0.2 : 0);
      if (!best || score < best.score)
        best = { index, suggestion: candidate, score };
    }

    if (!best || best.score > 1.45) return { ...model };
    usedCad.add(best.index);
    const evidence = best.suggestion;
    const widthDelta =
      Math.abs(evidence.width - model.width) /
      Math.max(0.25, evidence.width, model.width);
    const useCadWidth =
      openingWidthPlausible(model.kind, evidence.width) &&
      widthDelta <= 0.45;
    const roomIds =
      model.roomIds.length >= evidence.roomIds.length
        ? [...model.roomIds]
        : [...evidence.roomIds];
    const confidence = Number(
      Math.min(
        0.995,
        Math.max(model.confidence, evidence.confidence) +
          Math.min(model.confidence, evidence.confidence) * 0.06,
      ).toFixed(3),
    );

    return {
      ...model,
      roomIds,
      position: [
        evidence.position[0],
        model.position[1],
        evidence.position[2],
      ] as [number, number, number],
      width: useCadWidth ? evidence.width : model.width,
      rotationY: evidence.rotationY,
      wallDistance: Math.min(model.wallDistance, evidence.wallDistance),
      confidence,
      ready:
        model.ready &&
        evidence.confidence >= 0.72 &&
        roomIds.length > 0,
      reasons: [
        ...model.reasons,
        "normalized CAD plan corroborates opening position",
        ...(useCadWidth ? ["CAD plan width agrees with 3D evidence"] : []),
      ],
    };
  });

  const unmatchedCad = cad.filter((_, index) => !usedCad.has(index));
  return {
    suggestions: [...suggestions, ...unmatchedCad],
    cadEvidence: cad.length,
    matched: usedCad.size,
    cadOnlyReview: unmatchedCad.length,
  };
}

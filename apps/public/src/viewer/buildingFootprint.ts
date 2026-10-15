import * as THREE from "three";

const SITE_ONLY_NAME =
  /(?:^|[\\s_.-])(ground|terrain|grass|road|parking|paving|curb|kerb|sidewalk|driveway|compound|boundary|fence|gate|tree|trees|plant|plants|shrub|landscape|garden|lawn|site[\\s_.-]*wall|plot[\\s_.-]*wall|retaining[\\s_.-]*wall)(?:$|[\\s_.-])/i;
const BUILDING_NAME =
  /building|facade|floor|storey|story|structure|apartment|residential|column|pillar|structural|wall/i;

interface Candidate {
  box: THREE.Box3;
  height: number;
  semanticBuildingName: boolean;
}

export interface BuildingFootprint {
  bounds: THREE.Box3;
  /** Closed projected perimeter in world X/Z coordinates; empty when uncertain. */
  outline: Array<{ x: number; z: number }>;
}

function projectedOutline(root: THREE.Object3D, footprint: THREE.Box3) {
  const points: Array<{ x: number; z: number }> = [];
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(node);
    if (!validBox(box)) return;
    const overlapX = Math.max(0, Math.min(box.max.x, footprint.max.x) - Math.max(box.min.x, footprint.min.x));
    const overlapZ = Math.max(0, Math.min(box.max.z, footprint.max.z) - Math.max(box.min.z, footprint.min.z));
    const footprintArea = projectedArea(footprint);
    if (!footprintArea || overlapX * overlapZ < footprintArea * 0.0005) return;
    const names = namesForMesh(node, root);
    if (names.some((name) => SITE_ONLY_NAME.test(name))) return;
    const height = box.max.y - box.min.y;
    if (height < 0.35) return;
    for (const x of [box.min.x, box.max.x]) {
      for (const z of [box.min.z, box.max.z]) {
        if (
          x >= footprint.min.x - 0.2 && x <= footprint.max.x + 0.2 &&
          z >= footprint.min.z - 0.2 && z <= footprint.max.z + 0.2
        ) points.push({ x, z });
      }
    }
  });
  // A monotone-chain convex hull of actual Building-mesh projected vertices.
  const unique = points.filter((p, i) =>
    points.findIndex((q) => Math.hypot(p.x - q.x, p.z - q.z) < 1e-3) === i,
  ).sort((a, b) => a.x - b.x || a.z - b.z);
  if (unique.length < 3) return [];
  const cross = (o: {x:number;z:number}, a:{x:number;z:number}, b:{x:number;z:number}) =>
    (a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
  const lower: Array<{x:number;z:number}> = [];
  for (const p of unique) {
    while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],p)<=1e-7) lower.pop();
    lower.push(p);
  }
  const upper: Array<{x:number;z:number}> = [];
  for (const p of [...unique].reverse()) {
    while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],p)<=1e-7) upper.pop();
    upper.push(p);
  }
  const hull=[...lower.slice(0,-1),...upper.slice(0,-1)];
  return hull.length >= 3 ? hull : [];
}


function projectedArea(box: THREE.Box3) {
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, 0) * Math.max(size.z, 0);
}

function validBox(box: THREE.Box3) {
  return !box.isEmpty() && [
    box.min.x, box.min.y, box.min.z,
    box.max.x, box.max.y, box.max.z,
  ].every(Number.isFinite) &&
    box.max.x > box.min.x &&
    box.max.y > box.min.y &&
    box.max.z > box.min.z;
}

function unionCandidates(candidates: readonly Candidate[]) {
  const result = new THREE.Box3();
  for (const candidate of candidates) result.union(candidate.box);
  return result;
}

function namesForMesh(mesh: THREE.Mesh, root: THREE.Object3D) {
  const names: string[] = [];
  let current: THREE.Object3D | null = mesh;
  while (current && current !== root) {
    if (current.name.trim()) names.push(current.name);
    current = current.parent;
  }
  return names;
}

/**
 * Prefer a reviewed/profile Building box. For generic imports, infer the
 * Building footprint from vertically substantial structural meshes while
 * filtering thin site ground/paving and short compound walls. The returned box
 * is presentation masking data only; it never modifies source geometry.
 *
 * A single merged, semantically unnamed site/building mesh cannot be reliably
 * split from its bounds alone, so that case safely falls back to modelBounds.
 */
export function deriveBuildingFootprintBounds(
  root: THREE.Object3D,
  modelBounds: THREE.Box3,
  profileBounds?: THREE.Box3,
): THREE.Box3 {
  if (!validBox(modelBounds)) return modelBounds.clone();

  if (profileBounds && validBox(profileBounds)) {
    const modelArea = projectedArea(modelBounds);
    const profileArea = projectedArea(profileBounds);
    if (
      modelArea > 0 &&
      profileArea > 0 &&
      profileArea <= modelArea * 1.001
    )
      return profileBounds.clone();
  }

  const modelSize = modelBounds.getSize(new THREE.Vector3());
  const modelArea = projectedArea(modelBounds);
  if (modelArea <= 0 || modelSize.y <= 0) return modelBounds.clone();

  const minimumStoreyHeight = Math.max(
    2.25,
    Math.min(modelSize.y * 0.14, 2.8),
  );
  const tallStructureHeight = Math.max(
    minimumStoreyHeight,
    modelSize.y * 0.42,
  );
  const candidates: Candidate[] = [];

  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(node);
    if (!validBox(box)) return;

    const names = namesForMesh(node, root);
    // Ignore clearly non-building site dressing without treating a generic
    // mesh/group name such as "Site Model" as authoritative.
    if (names.some((name) => SITE_ONLY_NAME.test(name))) return;

    const height = box.max.y - box.min.y;
    if (height < minimumStoreyHeight) return;
    const semanticBuildingName = names.some((name) =>
      BUILDING_NAME.test(name),
    );
    candidates.push({ box, height, semanticBuildingName });
  });

  if (candidates.length === 0) return modelBounds.clone();

  const tall = candidates.filter(
    (candidate) => candidate.height >= tallStructureHeight,
  );
  const tallBounds = unionCandidates(tall);
  const tallRatio = projectedArea(tallBounds) / modelArea;
  if (
    validBox(tallBounds) &&
    tallRatio >= 0.01 &&
    tallRatio < 0.94 &&
    (tall.length >= 2 ||
      tall[0]?.semanticBuildingName ||
      tallRatio >= 0.06)
  )
    return tallBounds;

  // Most multi-storey BIM/FBX files contain a separate mesh for each
  // storey-sized wall/slab group. Those repeated-height pieces reveal the
  // Building footprint even when no profile metadata ships with a project.
  const storey = candidates.filter(
    (candidate) =>
      candidate.height >= minimumStoreyHeight &&
      candidate.height <= Math.max(minimumStoreyHeight * 1.65, 4.6),
  );
  const storeyBounds = unionCandidates(storey);
  const storeyRatio = projectedArea(storeyBounds) / modelArea;
  if (
    validBox(storeyBounds) &&
    storeyRatio >= 0.01 &&
    storeyRatio < 0.94 &&
    (storey.length >= 3 ||
      storey.some((candidate) => candidate.semanticBuildingName) ||
      storeyRatio >= 0.06)
  )
    return storeyBounds;

  // If geometry is merged or ambiguous, don't guess at an internal cutout.
  return modelBounds.clone();
}


/** Returns a conservative outline from building mesh geometry; falls back to box only when uncertain. */
export function deriveBuildingFootprint(
  root: THREE.Object3D,
  modelBounds: THREE.Box3,
  profileBounds?: THREE.Box3,
): BuildingFootprint {
  const bounds = deriveBuildingFootprintBounds(root, modelBounds, profileBounds);
  if (!validBox(bounds)) return { bounds: bounds.clone(), outline: [] };
  const outline = projectedOutline(root, bounds);
  const outlineArea = (() => {
    if (outline.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < outline.length; i += 1) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      area += a.x * b.z - b.x * a.z;
    }
    return Math.abs(area) * 0.5;
  })();
  const boxArea = projectedArea(bounds);
  // Reject a tiny or implausibly small hull; don't mask an area we can't identify.
  return outlineArea >= boxArea * 0.42
    ? { bounds, outline }
    : { bounds, outline: [] };
}

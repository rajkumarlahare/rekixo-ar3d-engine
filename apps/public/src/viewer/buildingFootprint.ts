import * as THREE from "three";

const SITE_ONLY_NAME =
  /(?:^|[\\s_.-])(ground|terrain|grass|road|parking|paving|curb|kerb|sidewalk|driveway|compound|boundary|fence|gate|tree|trees|plant|plants|shrub|landscape|garden|lawn|site[\\s_.-]*wall|plot[\\s_.-]*wall|retaining[\\s_.-]*wall)(?:$|[\\s_.-])/i;
const BUILDING_NAME =
  /building|facade|floor|storey|story|structure|apartment|residential|column|pillar|structural|wall/i;
const FLAT_BASE_NAME =
  /foundation|footing|plinth|podium|platform|ground[\\s_.-]*slab|floor[\\s_.-]*slab|base[\\s_.-]*slab/i;

interface Candidate {
  box: THREE.Box3;
  height: number;
  semanticBuildingName: boolean;
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

/** Projects actual mesh vertices into the floor plane and reduces them to an outline. */
export function deriveBuildingFootprintPolygon(
  root: THREE.Object3D,
  footprintBounds: THREE.Box3,
  profileBounds?: THREE.Box3,
): THREE.Vector2[] {
  if (!validBox(footprintBounds)) return [];
  const points: THREE.Vector2[] = [];
  const fromProfile = Boolean(profileBounds && validBox(profileBounds));
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const names = namesForMesh(node, root);
    if (names.some((name) => SITE_ONLY_NAME.test(name))) return;
    if (names.some((name) => FLAT_BASE_NAME.test(name))) return;
    const box = new THREE.Box3().setFromObject(node);
    if (!validBox(box)) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    if (!fromProfile) {
      const modelHeight = Math.max(footprintBounds.max.y - footprintBounds.min.y, 1);
      // Flat slab meshes are the usual source of the oversized white rectangle.
      // Require vertical structural extent instead of trusting names like "Floor".
      const tallEnough = size.y >= Math.max(0.8, modelHeight * 0.06);
      if (!tallEnough) return;
      if (box.max.x < footprintBounds.min.x - 0.25 ||
          box.min.x > footprintBounds.max.x + 0.25 ||
          box.max.z < footprintBounds.min.z - 0.25 ||
          box.min.z > footprintBounds.max.z + 0.25) return;
    } else {
      // Reviewed/profile box is authoritative: retain only meshes that overlap it.
      if (box.max.x < profileBounds!.min.x || box.min.x > profileBounds!.max.x ||
          box.max.z < profileBounds!.min.z || box.min.z > profileBounds!.max.z) return;
    }

    const position = node.geometry.getAttribute("position");
    const stride = Math.max(1, Math.floor(position.count / 1600));
    for (let index = 0; index < position.count; index += stride) {
      const local = new THREE.Vector3().fromBufferAttribute(position, index);
      local.applyMatrix4(node.matrixWorld);
      if (!Number.isFinite(local.x) || !Number.isFinite(local.z)) continue;
      // The plane projection clips incidental overhangs/terrain using the chosen
      // footprint bounds; hull remains a safe convex approximation of the walls.
      if (!fromProfile && (
        local.x < footprintBounds.min.x - 0.3 ||
        local.x > footprintBounds.max.x + 0.3 ||
        local.z < footprintBounds.min.z - 0.3 ||
        local.z > footprintBounds.max.z + 0.3
      )) continue;
      points.push(new THREE.Vector2(local.x, local.z));
    }
  });
  return points;
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

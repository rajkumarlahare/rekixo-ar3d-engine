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


/**
 * Extracts a conservative building perimeter from the projected source meshes.
 * The convex hull excludes arbitrary axis-aligned corners and follows rotated
 * footprints, while retaining any concave notches only when supported by clear
 * profile metadata in a future revision.
 */
export function deriveBuildingFootprintOutline(
  root: THREE.Object3D,
  footprint: THREE.Box3,
): Array<{ x: number; z: number }> {
  if (!validBox(footprint)) return [];
  const points: Array<{ x: number; z: number }> = [];
  const footprintArea = projectedArea(footprint);
  const modelHeight = footprint.max.y - footprint.min.y;
  const minimumStructuralHeight = Math.max(0.8, modelHeight * 0.06);
  const maxSamples = 24000;
  const worldPoint = new THREE.Vector3();

  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (points.length >= maxSamples || !(node instanceof THREE.Mesh)) return;
    const names = namesForMesh(node, root);
    if (
      names.some((name) => SITE_ONLY_NAME.test(name)) ||
      names.some((name) => FLAT_BASE_NAME.test(name))
    ) return;

    const box = new THREE.Box3().setFromObject(node);
    if (!validBox(box)) return;
    const size = box.getSize(new THREE.Vector3());
    const area = Math.max(0, size.x) * Math.max(0, size.z);
    // Ignore thin ground plates, paving, rails and trim. A named/profiled
    // building footprint still supplies bounds separately; this outline is
    // built from actual structural vertices rather than the corners of every
    // mesh's axis-aligned Box3.
    if (area < footprintArea * 0.001 || size.y < minimumStructuralHeight) return;

    const overlapX = Math.max(
      0,
      Math.min(box.max.x, footprint.max.x) - Math.max(box.min.x, footprint.min.x),
    );
    const overlapZ = Math.max(
      0,
      Math.min(box.max.z, footprint.max.z) - Math.max(box.min.z, footprint.min.z),
    );
    if (overlapX * overlapZ < footprintArea * 0.0005) return;

    const position = node.geometry.getAttribute("position");
    if (!position || position.count < 3) return;
    // Cap total work at model-load time; evenly sample dense meshes while
    // retaining all vertices from the smaller structural parts.
    const remaining = Math.max(3, maxSamples - points.length);
    const stride = Math.max(1, Math.ceil(position.count / Math.min(1800, remaining)));
    for (let index = 0; index < position.count && points.length < maxSamples; index += stride) {
      worldPoint.fromBufferAttribute(position, index).applyMatrix4(node.matrixWorld);
      if (
        !Number.isFinite(worldPoint.x) ||
        !Number.isFinite(worldPoint.z) ||
        worldPoint.x < footprint.min.x - 0.25 ||
        worldPoint.x > footprint.max.x + 0.25 ||
        worldPoint.z < footprint.min.z - 0.25 ||
        worldPoint.z > footprint.max.z + 0.25
      ) continue;
      points.push({ x: worldPoint.x, z: worldPoint.z });
    }
  });

  const uniqueMap = new Map<string, { x: number; z: number }>();
  for (const point of points) {
    uniqueMap.set(`${point.x.toFixed(4)},${point.z.toFixed(4)}`, point);
  }
  const unique = [...uniqueMap.values()].sort(
    (left, right) => left.x - right.x || left.z - right.z,
  );
  if (unique.length < 3) return [];

  const cross = (
    origin: { x: number; z: number },
    a: { x: number; z: number },
    b: { x: number; z: number },
  ) => (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);

  const lower: Array<{ x: number; z: number }> = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-7
    ) lower.pop();
    lower.push(point);
  }
  const upper: Array<{ x: number; z: number }> = [];
  for (const point of [...unique].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-7
    ) upper.pop();
    upper.push(point);
  }
  const outline = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let area = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index], b = outline[(index + 1) % outline.length];
    area += a.x * b.z - b.x * a.z;
  }
  // Do not create a small or obviously corrupt hole if source geometry is
  // merged, hidden, or has too few structural vertices.
  if (outline.length < 3 || Math.abs(area) * 0.5 < footprintArea * 0.42) return [];
  return outline;
}


export interface BuildingFootprintMask {
  source: "triangles" | "outline";
  /** Diagnostic coverage ratio used to validate source geometry quality. */
  sourceCoverageRatio: number;
  processedTriangles?: number;
  surfaceTriangles?: number;
  width: number;
  height: number;
  /** 255 marks building interior plus a small wall-edge safety margin. */
  data: Uint8Array;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Rasterizes the actual projected source triangles into a compact 2D mask.
 * A flood-fill closes structural wall loops so L/stepped footprints remain
 * concave; unlike a convex hull of boxes, their notches are not filled in.
 */
export function deriveBuildingFootprintMask(
  root: THREE.Object3D,
  footprint: THREE.Box3,
): BuildingFootprintMask | undefined {
  if (!validBox(footprint)) return undefined;
  root.updateMatrixWorld(true);

  const padding = 0.24;
  const minX = footprint.min.x - padding;
  const maxX = footprint.max.x + padding;
  const minZ = footprint.min.z - padding;
  const maxZ = footprint.max.z + padding;
  const extentX = maxX - minX;
  const extentZ = maxZ - minZ;
  if (extentX <= 0 || extentZ <= 0) return undefined;

  const longestPixels = 512;
  const density = longestPixels / Math.max(extentX, extentZ);
  const width = THREE.MathUtils.clamp(Math.round(extentX * density), 96, longestPixels);
  const height = THREE.MathUtils.clamp(Math.round(extentZ * density), 96, longestPixels);
  const total = width * height;
  const occupied = new Uint8Array(total);
  const world = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  const toPixel = (x: number, z: number) => ({
    x: THREE.MathUtils.clamp(((x - minX) / extentX) * (width - 1), 0, width - 1),
    y: THREE.MathUtils.clamp(((z - minZ) / extentZ) * (height - 1), 0, height - 1),
  });
  const setPixel = (x: number, y: number, radius = 1) => {
    const cx = Math.round(x), cy = Math.round(y);
    for (let py = Math.max(0, cy - radius); py <= Math.min(height - 1, cy + radius); py += 1) {
      for (let px = Math.max(0, cx - radius); px <= Math.min(width - 1, cx + radius); px += 1) {
        occupied[py * width + px] = 255;
      }
    }
  };
  const drawLine = (fromX: number, fromY: number, toX: number, toY: number) => {
    let x0 = Math.round(fromX), y0 = Math.round(fromY);
    const x1 = Math.round(toX), y1 = Math.round(toY);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      setPixel(x0, y0, 1);
      if (x0 === x1 && y0 === y1) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x0 += sx; }
      if (doubled <= dx) { error += dx; y0 += sy; }
    }
  };
  const fillTriangle = (
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ) => {
    const denominator =
      (p1.y - p2.y) * (p0.x - p2.x) +
      (p2.x - p1.x) * (p0.y - p2.y);
    if (Math.abs(denominator) < 0.3) return;
    const minXPixel = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxXPixel = Math.min(width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minYPixel = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxYPixel = Math.min(height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    for (let py = minYPixel; py <= maxYPixel; py += 1) {
      for (let px = minXPixel; px <= maxXPixel; px += 1) {
        const sampleX = px + 0.5, sampleY = py + 0.5;
        const u =
          ((p1.y - p2.y) * (sampleX - p2.x) +
            (p2.x - p1.x) * (sampleY - p2.y)) / denominator;
        const v =
          ((p2.y - p0.y) * (sampleX - p2.x) +
            (p0.x - p2.x) * (sampleY - p2.y)) / denominator;
        if (u >= -1e-4 && v >= -1e-4 && u + v <= 1.0001) {
          occupied[py * width + px] = 255;
        }
      }
    }
  };

  const footprintArea = projectedArea(footprint);
  let processedTriangles = 0;
  let surfaceTriangles = 0;
  const maxTriangles = 160_000;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || processedTriangles >= maxTriangles) return;
    const names = namesForMesh(node, root);
    if (
      names.some((name) => SITE_ONLY_NAME.test(name)) ||
      names.some((name) => FLAT_BASE_NAME.test(name))
    ) return;
    const box = new THREE.Box3().setFromObject(node);
    if (!validBox(box)) return;
    const size = box.getSize(new THREE.Vector3());
    if (size.y < 0.06 || size.x * size.z < footprintArea * 0.00025) return;
    const overlapX = Math.max(0, Math.min(box.max.x, footprint.max.x) - Math.max(box.min.x, footprint.min.x));
    const overlapZ = Math.max(0, Math.min(box.max.z, footprint.max.z) - Math.max(box.min.z, footprint.min.z));
    if (overlapX * overlapZ < footprintArea * 0.00025) return;

    const position = node.geometry.getAttribute("position");
    if (!position || position.count < 3) return;
    const index = node.geometry.getIndex();
    const count = index ? index.count : position.count;
    const triangleCount = Math.floor(count / 3);
    const stride = Math.max(1, Math.ceil(triangleCount / Math.max(1, maxTriangles - processedTriangles)));
    for (let triangle = 0; triangle < triangleCount && processedTriangles < maxTriangles; triangle += stride) {
      const getVertex = (vertex: number, target: THREE.Vector3) => {
        const vertexIndex = index ? index.getX(vertex) : vertex;
        target.fromBufferAttribute(position, vertexIndex).applyMatrix4(node.matrixWorld);
        return target;
      };
      getVertex(triangle * 3, a);
      getVertex(triangle * 3 + 1, b);
      getVertex(triangle * 3 + 2, c);
      processedTriangles += 1;
      if (
        ![a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].every(Number.isFinite)
      ) continue;
      if (
        Math.max(a.x, b.x, c.x) < minX || Math.min(a.x, b.x, c.x) > maxX ||
        Math.max(a.z, b.z, c.z) < minZ || Math.min(a.z, b.z, c.z) > maxZ
      ) continue;
      const pa = toPixel(a.x, a.z), pb = toPixel(b.x, b.z), pc = toPixel(c.x, c.z);
      // All actual projected edges contribute to a closed perimeter. Horizontal
      // and sloped floor/roof triangles also fill their real projected areas.
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
      const normalY = abz * acx - abx * acz;
      const normalLength = Math.hypot(aby * acz - abz * acy, normalY, abx * acy - aby * acx);
      if (normalLength > 1e-9 && Math.abs(normalY) / normalLength > 0.22) {
        surfaceTriangles += 1;
        fillTriangle(pa, pb, pc);
      } else {
        // Vertical wall triangles collapse into lines in X/Z projection; keep
        // their actual projected edges to close the external perimeter.
        drawLine(pa.x, pa.y, pb.x, pb.y);
        drawLine(pb.x, pb.y, pc.x, pc.y);
        drawLine(pc.x, pc.y, pa.x, pa.y);
      }
    }
  });

  if (processedTriangles < 8) return undefined;

  // Flood-fill the external background. Any unvisited cell is inside a closed
  // projected structural boundary or a projected floor/roof triangle.
  const surfaceCoverageRatio = occupied.reduce(
    (sum, value) => sum + (value ? 1 : 0),
    0,
  ) / total;

  // Try a true closed-shell fill first. Concave notches connected to the
  // outside stay empty; only enclosed structural areas are filled.
  const exterior = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  const seedExterior = (index: number) => {
    if (occupied[index] === 0 && exterior[index] === 0) {
      exterior[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) {
    seedExterior(x);
    seedExterior((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seedExterior(y * width);
    seedExterior(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width, y = Math.floor(index / width);
    if (x > 0) seedExterior(index - 1);
    if (x + 1 < width) seedExterior(index + 1);
    if (y > 0) seedExterior(index - width);
    if (y + 1 < height) seedExterior(index + width);
  }

  const enclosed = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (occupied[index] !== 0 || exterior[index] === 0) enclosed[index] = 255;
  }
  const enclosedCoverageRatio = enclosed.reduce(
    (sum, value) => sum + (value ? 1 : 0),
    0,
  ) / total;

  // If an exported wall loop has a doorway/gap that lets flood-fill leak,
  // retain the real projected floor/roof triangles rather than replacing the
  // shape with a rectangle. Flat source-site slabs are filtered above.
  let data: Uint8Array | undefined;
  let sourceCoverageRatio = 0;
  if (enclosedCoverageRatio >= 0.025 && enclosedCoverageRatio <= 0.985) {
    data = enclosed;
    sourceCoverageRatio = enclosedCoverageRatio;
  } else if (surfaceCoverageRatio >= 0.025 && surfaceCoverageRatio <= 0.985) {
    data = occupied.slice();
    sourceCoverageRatio = surfaceCoverageRatio;
  }

  if (data) {
    // Expand by two pixels: the grass starts just outside, never over the wall.
    for (let pass = 0; pass < 2; pass += 1) {
      const expanded = data.slice();
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          if (
            data[index] || data[index - 1] || data[index + 1] ||
            data[index - width] || data[index + width]
          ) expanded[index] = 255;
        }
      }
      data.set(expanded);
    }
    const finalRatio = data.reduce((sum, value) => sum + (value ? 1 : 0), 0) / total;
    if (finalRatio >= 0.025 && finalRatio <= 0.985) {
      return {
        source: "triangles" as const,
        sourceCoverageRatio,
        processedTriangles,
        surfaceTriangles,
        width,
        height,
        data,
        minX,
        minZ,
        maxX,
        maxZ,
      };
    }
  }

  // Some older exports have open or disconnected wall meshes. In that case,
  // fall back to an outline sampled from real source vertices (never the
  // oversized site's bounding-box corners) rather than accepting a corrupt mask.
  const outline = deriveBuildingFootprintOutline(root, footprint);
  if (outline.length < 3) return undefined;
  const fallback = new Uint8Array(total);
  const pointInside = (x: number, z: number) => {
    let inside = false;
    for (let current = 0, previous = outline.length - 1; current < outline.length; previous = current++) {
      const a = outline[current], b = outline[previous];
      const crosses = (a.z > z) !== (b.z > z) &&
        x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
      if (crosses) inside = !inside;
    }
    return inside;
  };
  const edgeDistance = (x: number, z: number, a: {x:number;z:number}, b: {x:number;z:number}) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared < 1e-12 ? 0 : THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/lengthSquared,0,1);
    return Math.hypot(x - (a.x + dx*t), z - (a.z + dz*t));
  };
  let fallbackFilled = 0;
  for (let y = 0; y < height; y += 1) {
    const z = minZ + ((y + 0.5) / height) * extentZ;
    for (let x = 0; x < width; x += 1) {
      const worldX = minX + ((x + 0.5) / width) * extentX;
      let inside = pointInside(worldX, z);
      if (!inside) {
        for (let edge = 0; edge < outline.length; edge += 1) {
          if (edgeDistance(worldX, z, outline[edge], outline[(edge + 1) % outline.length]) <= padding) {
            inside = true;
            break;
          }
        }
      }
      if (inside) {
        fallback[y * width + x] = 255;
        fallbackFilled += 1;
      }
    }
  }
  const fallbackRatio = fallbackFilled / total;
  if (fallbackRatio < 0.025 || fallbackRatio > 0.985) return undefined;
  return {
    source: "outline" as const,
    sourceCoverageRatio,
    processedTriangles,
    surfaceTriangles,
    width,
    height,
    data: fallback,
    minX,
    minZ,
    maxX,
    maxZ,
  };
}

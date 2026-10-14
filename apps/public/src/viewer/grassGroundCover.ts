import * as THREE from "three";
import { proceduralSurfaceTexture } from "./proceduralSurfaceMaterials";

export interface GrassCoverArea {
  kind: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  y?: number;
  height?: number;
}

export interface GrassGroundCoverOptions {
  /** Overall loaded site/model bounds used to size the distant landscape. */
  bounds: THREE.Box3;
  /** Measured building bounds used only for the inner ground cutout. */
  footprintBounds?: THREE.Box3;
  /** Measured footprint vertices in world X/Z coordinates when available. */
  footprintPoints?: readonly THREE.Vector2[];
  groundElevation: number;
  mobile: boolean;
  /** Reviewed paving/road areas plus any generated fallback hardscape. */
  excludedAreas: readonly GrassCoverArea[];
  /** Reviewed lawn rectangles get blades rooted at the lawn's actual top surface. */
  lawnAreas: readonly GrassCoverArea[];
}

interface GrassBladeInstance {
  x: number;
  y: number;
  z: number;
  rotation: number;
  color: THREE.Color;
  variation: number;
}

const GRASS_HEIGHTS_METRES = [0.0254, 0.0508, 0.0762] as const;
const TAU = Math.PI * 2;

function smooth01(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function seededRandom(initialSeed: number) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function containsArea(x: number, z: number, area: GrassCoverArea, padding = 0) {
  const angle = THREE.MathUtils.degToRad(area.rotation || 0);
  const dx = x - area.x;
  const dz = z - area.z;
  const localX = dx * Math.cos(angle) - dz * Math.sin(angle);
  const localZ = dx * Math.sin(angle) + dz * Math.cos(angle);
  return (
    Math.abs(localX) <= area.width / 2 + padding &&
    Math.abs(localZ) <= area.depth / 2 + padding
  );
}

function surfaceYFor(
  x: number,
  z: number,
  groundElevation: number,
  lawnAreas: readonly GrassCoverArea[],
) {
  for (let index = lawnAreas.length - 1; index >= 0; index -= 1) {
    const area = lawnAreas[index];
    if (!containsArea(x, z, area, -0.015)) continue;
    const height = Math.max(0.02, area.height ?? 0.02);
    return (area.y ?? groundElevation) + height + 0.012;
  }
  return groundElevation + 0.004;
}

interface GroundRingPoint {
  x: number;
  z: number;
}

function convexHull(points: readonly THREE.Vector2[]): THREE.Vector2[] {
  const unique = new Map<string, THREE.Vector2>();
  for (const point of points) unique.set(`${point.x.toFixed(5)},${point.y.toFixed(5)}`, point.clone());
  const sorted = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 3) return sorted;
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-7) lower.pop();
    lower.push(point);
  }
  const upper: THREE.Vector2[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-7) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function insetFromCenter(hull: readonly THREE.Vector2[], amount: number): THREE.Vector2[] {
  if (hull.length < 3) return hull.map(point => point.clone());
  const center = hull.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(1 / hull.length);
  // A conservative radial inset avoids a rectangular terrain slab. The outline
  // follows the source footprint vertices while staying just outside the walls.
  return hull.map(point => {
    const direction = center.clone().sub(point);
    const distance = direction.length();
    if (distance <= amount + 0.01) return point.clone();
    return point.clone().addScaledVector(direction.normalize(), amount);
  });
}

function pointInPolygon(x: number, z: number, polygon: readonly THREE.Vector2[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const xi = polygon[index].x, zi = polygon[index].y;
    const xj = polygon[previous].x, zj = polygon[previous].y;
    const crosses = (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function createCurvedGroundGeometry(
  radius: number,
  rise: number,
  mobile: boolean,
  footprint: readonly THREE.Vector2[],
) {
  const baseSegments = mobile ? 64 : 112;
  const rings = mobile ? 22 : 36;
  const safeFootprint = footprint.length >= 3
    ? footprint
    : [new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0.5, 0.5), new THREE.Vector2(-0.5, 0.5)];
  const inner = insetFromCenter(safeFootprint, 0.06);
  const center = safeFootprint.reduce((sum, p) => sum.add(p), new THREE.Vector2()).multiplyScalar(1 / safeFootprint.length);
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const innerPoints = inner.map(point => new THREE.Vector2(point.x - center.x, point.y - center.y));
  const count = Math.max(baseSegments, innerPoints.length);
  const innerPerimeter: THREE.Vector2[] = [];
  // Uniformly sample the actual polygon perimeter so inner and outer rings share
  // vertices and the annulus remains a connected, low-poly surface.
  const edgeLengths = innerPoints.map((p, i) => p.distanceTo(innerPoints[(i + 1) % innerPoints.length]));
  const perimeter = edgeLengths.reduce((sum, value) => sum + value, 0);
  for (let sample = 0; sample < count; sample += 1) {
    let distance = (sample / count) * perimeter;
    let edge = 0;
    while (edge < edgeLengths.length - 1 && distance > edgeLengths[edge]) {
      distance -= edgeLengths[edge++];
    }
    const from = innerPoints[edge];
    const to = innerPoints[(edge + 1) % innerPoints.length];
    const t = distance / Math.max(edgeLengths[edge], 1e-9);
    innerPerimeter.push(from.clone().lerp(to, t));
  }

  const turfNear = new THREE.Color("#557e3e");
  const turfFar = new THREE.Color("#748f60");
  const horizonHaze = new THREE.Color("#a3bdba");
  const cloudEdge = new THREE.Color("#c7d9e0");
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const bend = smooth01((t - 0.70) / 0.30);
    const lift = rise * bend * bend;
    const tint = t < 0.70
      ? turfNear.clone().lerp(turfFar, smooth01(t / 0.70) * 0.22)
      : t < 0.84
        ? turfFar.clone().lerp(horizonHaze, smooth01((t - 0.70) / 0.14))
        : horizonHaze.clone().lerp(cloudEdge, smooth01((t - 0.84) / 0.16));
    for (let segment = 0; segment < count; segment += 1) {
      const angle = (segment / count) * TAU;
      const outerX = Math.cos(angle) * radius;
      const outerZ = Math.sin(angle) * radius;
      const innerPoint = innerPerimeter[segment];
      const x = innerPoint.x + (outerX - innerPoint.x) * t;
      const z = innerPoint.y + (outerZ - innerPoint.y) * t;
      positions.push(x, lift, z);
      colors.push(tint.r, tint.g, tint.b);
      uvs.push(x / 8, z / 8);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    const start = ring * count;
    const outer = (ring + 1) * count;
    for (let segment = 0; segment < count; segment += 1) {
      const next = (segment + 1) % count;
      const a = start + segment, b = start + next;
      const c = outer + next, d = outer + segment;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createGrassClumpGeometry() {
  const positions: number[] = [];
  const indices: number[] = [];
  const addVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const triangle = (a: number, b: number, c: number) => {
    indices.push(a, b, c);
  };

  for (let blade = 0; blade < 5; blade += 1) {
    const angle = (blade / 5) * TAU;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const px = -dz;
    const pz = dx;
    const spread = 0.12 + (blade % 2) * 0.035;
    const baseX = dx * (0.06 + (blade % 3) * 0.025);
    const baseZ = dz * (0.06 + (blade % 3) * 0.025);
    const halfBase = 0.12;
    const halfMid = 0.075;

    const baseLeft = addVertex(baseX + px * halfBase, 0, baseZ + pz * halfBase);
    const baseRight = addVertex(baseX - px * halfBase, 0, baseZ - pz * halfBase);
    const midLeft = addVertex(baseX + dx * spread + px * halfMid, 0.54, baseZ + dz * spread + pz * halfMid);
    const midRight = addVertex(baseX + dx * spread - px * halfMid, 0.54, baseZ + dz * spread - pz * halfMid);
    const tip = addVertex(baseX + dx * (spread * 1.9) + px * 0.055, 1, baseZ + dz * (spread * 1.9) + pz * 0.055);

    triangle(baseLeft, midLeft, baseRight);
    triangle(baseRight, midLeft, midRight);
    triangle(midLeft, tip, midRight);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createInstances(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  instances: readonly GrassBladeInstance[],
  tier: 0 | 1 | 2,
) {
  if (instances.length === 0) return;
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  mesh.name = `Universal grass blades ${GRASS_HEIGHTS_METRES[tier] * 1000}mm`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const dummy = new THREE.Object3D();
  instances.forEach((instance, index) => {
    const height = GRASS_HEIGHTS_METRES[tier] * instance.variation;
    const width = Math.max(0.045, height * 1.8);
    dummy.position.set(instance.x, instance.y, instance.z);
    dummy.rotation.set(0, instance.rotation, 0);
    dummy.scale.set(width, height, width);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, instance.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
}

/** Presentation-only grass underlay with a low-cost curved, cloud-tinted horizon. */
export function createUniversalGrassGroundCover(options: GrassGroundCoverOptions) {
  const { bounds, groundElevation, mobile, excludedAreas, lawnAreas } = options;
  const root = new THREE.Group();
  root.name = "Universal grass ground cover and curved horizon";
  root.userData.presentationOnly = true;
  root.userData.nonAuthoritative = true;
  root.userData.staticSiteContext = true;

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  // The loaded source may contain an outer compound wall or site paving. Only
  // the measured Building bounds should become an interior grass-free hole.
  const footprintBounds = options.footprintBounds ?? bounds;
  const footprintSize = footprintBounds.getSize(new THREE.Vector3());
  const footprintCenter = footprintBounds.getCenter(new THREE.Vector3());
  const footprintPoints = options.footprintPoints?.length
    ? options.footprintPoints
    : [
        new THREE.Vector2(footprintBounds.min.x, footprintBounds.min.z),
        new THREE.Vector2(footprintBounds.max.x, footprintBounds.min.z),
        new THREE.Vector2(footprintBounds.max.x, footprintBounds.max.z),
        new THREE.Vector2(footprintBounds.min.x, footprintBounds.max.z),
      ];
  const footprintHull = convexHull(footprintPoints);
  const span = Math.max(size.x, size.z, 8);
  const siteCorners = [
    [bounds.min.x, bounds.min.z],
    [bounds.min.x, bounds.max.z],
    [bounds.max.x, bounds.min.z],
    [bounds.max.x, bounds.max.z],
  ];
  const farthestSiteCorner = Math.max(
    ...siteCorners.map(([x, z]) =>
      Math.hypot(x - footprintCenter.x, z - footprintCenter.z),
    ),
  );
  const preferredRadius = Math.min(Math.max(span * 5, 75), 2000);
  const radius = Math.max(
    preferredRadius,
    farthestSiteCorner + Math.max(span * 0.12, 10),
    footprintSize.x / 2 + footprintSize.z / 2 + 5,
  );
  const rise = Math.min(Math.max(span * 0.65, 5), 12);
  const geometry = createCurvedGroundGeometry(
    radius,
    rise,
    mobile,
    footprintHull.map(point => new THREE.Vector2(point.x - footprintCenter.x, point.y - footprintCenter.z)),
  );
  const terrainMaterial = new THREE.MeshStandardMaterial({
    name: "Procedural turf blending into a soft cloud horizon",
    color: "#ffffff",
    map: proceduralSurfaceTexture("grass"),
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
  });
  const ground = new THREE.Mesh(geometry, terrainMaterial);
  ground.name = "Curved turf and horizon surface";
  ground.castShadow = false;
  ground.receiveShadow = !mobile;
  root.add(ground);
  // The annular terrain is centered on the actual building footprint, while
  // its radius is large enough to cover the full loaded site bounds.
  root.position.set(
    footprintCenter.x,
    groundElevation - 0.055,
    footprintCenter.z,
  );

  const targetCount = mobile ? 720 : 3600;
  const bladeRadius = Math.min(Math.max(span * 0.78, 12), 28);
  const random = seededRandom(
    Math.floor(span * 1000) ^
      Math.floor(Math.abs(center.x) * 17) ^
      Math.floor(Math.abs(center.z) * 31) ^
      0x5f3759df,
  );
  const instances: GrassBladeInstance[][] = [[], [], []];
  let attempts = 0;
  const maxAttempts = targetCount * 12;
  while (instances[0].length + instances[1].length + instances[2].length < targetCount && attempts < maxAttempts) {
    attempts += 1;
    const angle = random() * TAU;
    const distance = Math.sqrt(random()) * bladeRadius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const worldX = center.x + x;
    const worldZ = center.z + z;

    if (pointInPolygon(worldX, worldZ, footprintHull)) continue;
    if (excludedAreas.some((area) => containsArea(worldX, worldZ, area, 0.035))) continue;

    const slot = instances[0].length + instances[1].length + instances[2].length;
    const tier: 0 | 1 | 2 = slot % 10 < 5 ? 0 : slot % 10 < 8 ? 1 : 2;
    const color = new THREE.Color().setHSL(
      0.255 + random() * 0.055,
      0.34 + random() * 0.25,
      0.27 + random() * 0.12,
    );
    const surfaceY = surfaceYFor(worldX, worldZ, groundElevation, lawnAreas);
    instances[tier].push({
      // Blade instances are rooted relative to the building-centered ground
      // mesh, not the overall source-model/site center.
      x: worldX - footprintCenter.x,
      y: surfaceY - (groundElevation - 0.055) + 0.001,
      z: worldZ - footprintCenter.z,
      rotation: random() * TAU,
      color,
      variation: 0.88 + random() * 0.24,
    });
  }

  const blades = createGrassClumpGeometry();
  for (const tier of [0, 1, 2] as const) {
    createInstances(root, blades, instances[tier], tier);
  }

  const setNight = (night: boolean) => {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const entry of materials) {
        if (entry instanceof THREE.MeshStandardMaterial) {
          entry.color.set(night ? "#5d6879" : "#ffffff");
        }
      }
    });
  };

  root.userData.footprintOutlineVertexCount = footprintHull.length;
  root.userData.grassBladeInstanceCount = instances.reduce((sum, tier) => sum + tier.length, 0);
  root.userData.grassBladeTierCounts = instances.map((tier) => tier.length);
  root.userData.horizonRadius = radius;
  root.userData.horizonRise = rise;

  return {
    root,
    setNight,
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((entry) => materials.add(entry));
      });
      geometries.forEach((entry) => entry.dispose());
      materials.forEach((entry) => entry.dispose());
      root.clear();
    },
  };
}

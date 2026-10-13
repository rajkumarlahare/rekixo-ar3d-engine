import * as THREE from "three";
import { createProceduralSurfaceMaterial, type ProceduralSurfaceKind } from "./proceduralSurfaceMaterials";

function material(
  color: string,
  roughness = 0.82,
  metalness = 0,
  opacity = 1,
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent: opacity < 1,
    opacity,
  });
}

function surfaceKindForName(name: string): ProceduralSurfaceKind | undefined {
  const normalized = name.toLowerCase();
  if (normalized.includes("marking")) return undefined;
  if (normalized.includes("road")) return "asphalt";
  if (normalized.includes("lawn")) return "grass";
  if (normalized.includes("ground") || normalized.includes("sidewalk") ||
      normalized.includes("curb") || normalized.includes("driveway"))
    return normalized.includes("surrounding") ? "soil" : "paving";
  return undefined;
}

function addBox(
  root: THREE.Group,
  name: string,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  color: string,
  options: {
    rotation?: number;
    roughness?: number;
    metalness?: number;
    opacity?: number;
    castShadow?: boolean;
  } = {},
) {
  const surfaceKind = surfaceKindForName(name);
  const surfaceMaterial =
    surfaceKind && (options.opacity === undefined || options.opacity === 1)
      ? createProceduralSurfaceMaterial(
          color,
          surfaceKind,
          options.roughness ?? 0.84,
          options.metalness ?? 0,
        )
      : material(
          color,
          options.roughness ?? 0.84,
          options.metalness ?? 0,
          options.opacity ?? 1,
        );
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      Math.max(width, 0.02),
      Math.max(height, 0.02),
      Math.max(depth, 0.02),
    ),
    surfaceMaterial,
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = THREE.MathUtils.degToRad(options.rotation ?? 0);
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addTree(
  root: THREE.Group,
  x: number,
  y: number,
  z: number,
  height: number,
  crownWidth: number,
  mobile: boolean,
  color = "#487a4d",
) {
  const tree = new THREE.Group();
  tree.name = "Site tree";
  tree.position.set(x, y, z);

  const trunkHeight = Math.max(height * 0.46, 0.8);
  const trunkRadius = Math.max(crownWidth * 0.055, 0.07);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(
      trunkRadius * 0.9,
      trunkRadius * 1.08,
      trunkHeight,
      mobile ? 7 : 10,
    ),
    material("#725239", 0.95),
  );
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = !mobile;
  trunk.receiveShadow = true;
  tree.add(trunk);

  const crownHeight = Math.max(height - trunkHeight * 0.58, crownWidth * 0.95);
  const geometry = new THREE.SphereGeometry(1, mobile ? 8 : 14, mobile ? 5 : 9);
  const foliageMaterial = material(color, 0.96);
  const clusters = mobile ? 14 : 28;
  const crowns = new THREE.InstancedMesh(geometry, foliageMaterial, clusters);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < clusters; i++) {
    const angle = i * 2.39996;
    const level = (i + 0.5) / clusters;
    const spread = Math.sin(level * Math.PI) * crownWidth * 0.42;
    const radius = crownWidth * (0.15 + (i % 3) * 0.025);
    dummy.position.set(Math.cos(angle) * spread, trunkHeight * 0.66 + level * crownHeight * 0.88, Math.sin(angle) * spread);
    dummy.scale.set(radius, radius * 1.12, radius);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  }
  crowns.name = "Site tree foliage";
  crowns.castShadow = !mobile;
  crowns.receiveShadow = true;
  crowns.instanceMatrix.needsUpdate = true;
  tree.add(crowns);

  root.add(tree);
}

function addPlant(
  root: THREE.Group,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  mobile: boolean,
  color = "#4f8d58",
) {
  const group = new THREE.Group();
  group.name = "Site plant";
  group.position.set(x, y, z);

  const potHeight = Math.max(height * 0.22, 0.14);
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.15, width * 0.19, potHeight, mobile ? 7 : 10),
    material("#8d6244", 0.94),
  );
  pot.position.y = potHeight / 2;
  pot.castShadow = !mobile;
  group.add(pot);

  const foliage = new THREE.Mesh(
    new THREE.SphereGeometry(1, mobile ? 8 : 14, mobile ? 5 : 9),
    material(color, 0.96),
  );
  foliage.name = "Site plant foliage";
  foliage.scale.set(width * 0.38, height * 0.4, width * 0.38);
  foliage.position.y = potHeight + height * 0.36;
  foliage.castShadow = !mobile;
  group.add(foliage);
  root.add(group);
}

function addLamp(
  root: THREE.Group,
  x: number,
  y: number,
  z: number,
  height: number,
  mobile: boolean,
  bulbMaterials: THREE.MeshStandardMaterial[],
) {
  const group = new THREE.Group();
  group.name = "Site outdoor light";
  group.position.set(x, y, z);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, height, mobile ? 7 : 10),
    material("#4c5359", 0.52, 0.32),
  );
  pole.position.y = height / 2;
  pole.castShadow = !mobile;
  group.add(pole);

  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: "#fff0c7",
    emissive: "#ffc870",
    emissiveIntensity: 0.32,
    roughness: 0.24,
  });
  bulbMaterials.push(bulbMaterial);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, mobile ? 7 : 10, mobile ? 5 : 7),
    bulbMaterial,
  );
  bulb.position.y = height;
  group.add(bulb);
  root.add(group);
}

function addCar(root: THREE.Group, x: number, y: number, z: number, length: number, color: string) {
  const group = new THREE.Group();
  group.name = "Presentation parked car";
  group.position.set(x, y, z);
  const width = length * 0.42;
  addBox(group, "Car body", length, length * 0.16, width, 0, length * 0.20, 0, color, { roughness: 0.3, metalness: 0.25, castShadow: true });
  addBox(group, "Car glazing", length * 0.54, length * 0.19, width * 0.89, -length * 0.06, length * 0.37, 0, "#304c60", { roughness: 0.14, metalness: 0.1, castShadow: true });
  addBox(group, "Car roof", length * 0.45, 0.04, width * 0.9, -length * 0.06, length * 0.48, 0, color, { roughness: 0.3 });
  const wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(length * 0.09, length * 0.09, width * 0.1, 12), material("#20252a"), 4);
  const part = new THREE.Object3D();
  let index = 0;
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    part.position.set(front * length * 0.32, length * 0.105, side * width * 0.5);
    part.rotation.x = Math.PI / 2; part.updateMatrix(); wheels.setMatrixAt(index++, part.matrix);
  }
  wheels.castShadow = true; group.add(wheels); root.add(group);
}

export type PresentationLandscapePreset =
  | "auto"
  | "urban"
  | "suburban"
  | "rural-farm"
  | "hillside";


/** Build a low-cost agricultural edge without crossing the measured building/site bounds. */
function addFarmFields(
  root: THREE.Group,
  bounds: THREE.Box3,
  mobile: boolean,
  baseY: number,
  span: number,
  margin: number,
) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const fieldWidth = Math.max(span * 0.68, 7);
  const fieldDepth = Math.max(size.z + margin * 0.85, span * 1.25);
  const rowCount = mobile ? 7 : 13;
  const plantsPerRow = mobile ? 12 : 24;
  const cropGeometry = new THREE.ConeGeometry(mobile ? 0.055 : 0.07, mobile ? 0.32 : 0.44, 4);
  const cropMaterial = material("#75914b", 0.98);
  const cropGoldMaterial = material("#a3a15a", 0.98);

  for (const side of [-1, 1]) {
    const fieldX =
      side < 0
        ? bounds.min.x - margin * 0.45 - fieldWidth / 2
        : bounds.max.x + margin * 0.45 + fieldWidth / 2;
    addBox(
      root,
      "Presentation farm field soil",
      fieldWidth,
      0.055,
      fieldDepth,
      fieldX,
      baseY - 0.055,
      center.z - margin * 0.16,
      "#8d8b60",
      { roughness: 1 },
    );

    const rowGeometry = new THREE.BoxGeometry(0.038, 0.018, fieldDepth * 0.96);
    const furrows = new THREE.InstancedMesh(
      rowGeometry,
      material("#687449", 1),
      rowCount,
    );
    furrows.name = "Presentation farm field rows";
    furrows.receiveShadow = true;
    const rowStep = fieldWidth / rowCount;
    const dummy = new THREE.Object3D();
    for (let row = 0; row < rowCount; row++) {
      dummy.position.set(
        fieldX - fieldWidth / 2 + rowStep * (row + 0.5),
        baseY - 0.017,
        center.z - margin * 0.16,
      );
      dummy.updateMatrix();
      furrows.setMatrixAt(row, dummy.matrix);
    }
    furrows.instanceMatrix.needsUpdate = true;
    root.add(furrows);
    rowGeometry.dispose();

    const count = rowCount * plantsPerRow;
    const crops = new THREE.InstancedMesh(
      cropGeometry,
      side < 0 ? cropMaterial : cropGoldMaterial,
      count,
    );
    crops.name = "Site plant foliage";
    crops.castShadow = !mobile;
    crops.receiveShadow = true;
    let index = 0;
    for (let row = 0; row < rowCount; row++) {
      for (let plant = 0; plant < plantsPerRow; plant++) {
        const along = (plant + 0.5) / plantsPerRow - 0.5;
        const deterministicJitter = Math.sin((row + 1) * 11.73 + plant * 3.17) * 0.055;
        dummy.position.set(
          fieldX - fieldWidth / 2 + rowStep * (row + 0.5) + deterministicJitter,
          baseY + (mobile ? 0.14 : 0.2),
          center.z - margin * 0.16 + along * fieldDepth,
        );
        dummy.rotation.set(
          Math.sin(plant * 0.6 + row) * 0.055,
          (row % 2) * 0.12,
          Math.cos(plant * 0.4 + row) * 0.04,
        );
        const variation = 0.78 + ((row * 7 + plant * 3) % 5) * 0.07;
        dummy.scale.set(variation, variation, variation);
        dummy.updateMatrix();
        crops.setMatrixAt(index++, dummy.matrix);
      }
    }
    crops.instanceMatrix.needsUpdate = true;
    root.add(crops);
  }
}

/** Distant soft ridges provide a horizon without creating geometry over the source site. */
function addHillsideBackdrop(
  root: THREE.Group,
  center: THREE.Vector3,
  baseY: number,
  span: number,
  mobile: boolean,
) {
  const geometry = new THREE.SphereGeometry(1, mobile ? 12 : 20, mobile ? 7 : 12);
  const ridgeSpecs = [
    { x: -2.6, z: -2.5, sx: 2.3, sy: 0.42, sz: 1.35, color: "#798b70" },
    { x: 2.8, z: -3.0, sx: 2.5, sy: 0.52, sz: 1.45, color: "#687f67" },
    { x: 0.1, z: 3.0, sx: 2.9, sy: 0.38, sz: 1.5, color: "#93a084" },
    { x: -3.5, z: 0.4, sx: 1.6, sy: 0.32, sz: 2.2, color: "#849277" },
    { x: 3.5, z: -0.6, sx: 1.8, sy: 0.34, sz: 2.1, color: "#7e8e73" },
  ];
  for (const [index, spec] of ridgeSpecs.entries()) {
    const ridge = new THREE.Mesh(
      geometry,
      material(spec.color, 1),
    );
    ridge.name = `Presentation hillside ridge ${index + 1}`;
    ridge.position.set(
      center.x + spec.x * span,
      baseY - span * 0.16,
      center.z + spec.z * span,
    );
    ridge.scale.set(span * spec.sx, span * spec.sy, span * spec.sz);
    ridge.receiveShadow = true;
    root.add(ridge);
  }
}

/** Minimal hazed silhouettes establish an urban skyline at a distance from the property. */
function addUrbanContext(
  root: THREE.Group,
  center: THREE.Vector3,
  baseY: number,
  span: number,
  mobile: boolean,
) {
  const count = mobile ? 5 : 10;
  const colors = ["#919b9e", "#a1a5a1", "#8b989d", "#b1b0a5"];
  const addRow = (axis: "x" | "z", sign: -1 | 1, row: number) => {
    for (let index = 0; index < count; index++) {
      const phase = index + row * 2.1;
      const width = span * (0.22 + ((index * 7 + row * 3) % 4) * 0.045);
      const height = span * (0.18 + ((index * 5 + row * 2) % 6) * 0.055);
      const depth = span * (0.16 + ((index * 3 + row) % 3) * 0.045);
      const offset = (index - (count - 1) / 2) * span * 0.53;
      const distance = span * (3.8 + row * 0.75);
      const x = axis === "z" ? center.x + offset : center.x + sign * distance;
      const z = axis === "x" ? center.z + offset : center.z + sign * distance;
      addBox(
        root,
        "Presentation distant urban context",
        axis === "z" ? width : depth,
        height,
        axis === "x" ? width : depth,
        x,
        baseY + height / 2 - span * 0.02,
        z,
        colors[(index + row) % colors.length],
        { roughness: 0.98, castShadow: false },
      );
      // Small roofline variation breaks the repeated block silhouette.
      if (!mobile && index % 3 === 1) {
        addBox(
          root,
          "Presentation distant urban roofline",
          width * 0.48,
          height * 0.06,
          depth * 0.48,
          x,
          baseY + height + height * 0.03 - span * 0.02,
          z,
          "#858f91",
          { roughness: 1, castShadow: false },
        );
      }
      void phase;
    }
  };
  addRow("z", -1, 0);
  addRow("z", 1, 1);
  addRow("x", -1, 0);
  addRow("x", 1, 1);
}


/**
 * Adds local street blocks and residential/commercial neighbours outside the
 * measured source bounds. These are presentation dressing only: they never
 * replace or intersect the reviewed Building/site geometry.
 */
function addNeighborhoodBuilding(
  root: THREE.Group,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  baseY: number,
  span: number,
  mobile: boolean,
  urban: boolean,
  variant: number,
) {
  const palettes = [
    { wall: "#c8c1b4", roof: "#655e57", glass: "#446174", trim: "#e6dfd2" },
    { wall: "#d2c4ae", roof: "#795c4c", glass: "#3d5a6e", trim: "#eee2cf" },
    { wall: "#aeb8b8", roof: "#626c70", glass: "#344d61", trim: "#dce3df" },
    { wall: "#c4b7a9", roof: "#6b5147", glass: "#38556a", trim: "#e7d9ca" },
    { wall: "#b9c1b5", roof: "#60665d", glass: "#405c6c", trim: "#e1e4d7" },
  ];
  const palette = palettes[variant % palettes.length];
  const floorHeight = urban
    ? Math.max(span * 0.08, 2.8)
    : Math.max(span * 0.13, 2.7);
  const floorCount = Math.max(2, Math.floor(height / floorHeight));
  const actualHeight = floorHeight * floorCount;
  const topOffset = Math.max(0.09, span * 0.012);

  addBox(
    root,
    "Presentation neighborhood lawn plot",
    width * 1.28,
    0.055,
    depth * 1.28,
    x,
    baseY - 0.025,
    z,
    variant % 2 === 0 ? "#54734d" : "#607a50",
    { roughness: 1 },
  );
  addBox(
    root,
    "Presentation neighborhood building plinth",
    width * 1.025,
    Math.max(0.09, span * 0.012),
    depth * 1.025,
    x,
    baseY + topOffset / 2,
    z,
    palette.trim,
    { roughness: 0.92, castShadow: !mobile },
  );
  addBox(
    root,
    urban ? "Presentation urban mid-rise facade" : "Presentation neighborhood house facade",
    width,
    actualHeight,
    depth,
    x,
    baseY + actualHeight / 2 + topOffset,
    z,
    palette.wall,
    { roughness: 0.88, castShadow: !mobile },
  );

  if (urban) {
    const roofLip = Math.max(0.1, span * 0.015);
    addBox(
      root,
      "Presentation urban parapet roof",
      width * 1.055,
      roofLip,
      depth * 1.055,
      x,
      baseY + actualHeight + roofLip / 2 + topOffset,
      z,
      palette.roof,
      { roughness: 0.91, castShadow: !mobile },
    );
    if (!mobile) {
      for (const offset of [-0.22, 0.22]) {
        addBox(
          root,
          "Presentation rooftop plant equipment",
          width * 0.12,
          Math.max(0.12, span * 0.025),
          depth * 0.14,
          x + width * offset,
          baseY + actualHeight + roofLip + span * 0.025 + topOffset,
          z,
          "#788181",
          { roughness: 0.76, metalness: 0.12 },
        );
      }
    }
  } else {
    // Two shallow roof planes read as a gable from street-level camera angles.
    const roofThickness = Math.max(0.09, span * 0.014);
    const roofRise = width * 0.12;
    const slopeAngle = Math.atan(roofRise / (width * 0.58));
    for (const side of [-1, 1]) {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.59, roofThickness, depth * 1.08),
        material(palette.roof, 0.93),
      );
      roof.name = "Presentation neighborhood pitched roof";
      roof.position.set(
        x + side * width * 0.25,
        baseY + actualHeight + roofRise * 0.5 + topOffset,
        z,
      );
      roof.rotation.z = side < 0 ? slopeAngle : -slopeAngle;
      roof.castShadow = !mobile;
      roof.receiveShadow = true;
      root.add(roof);
    }
  }

  const frontColumns = Math.max(
    2,
    Math.min(mobile ? 3 : 5, Math.floor(width / Math.max(span * 0.08, 0.8))),
  );
  const sideColumns = Math.max(
    2,
    Math.min(mobile ? 2 : 4, Math.floor(depth / Math.max(span * 0.09, 0.8))),
  );
  const windowWidth = Math.max(
    0.18,
    Math.min(span * 0.065, width / (frontColumns + 1) * 0.52),
  );
  const windowHeight = Math.max(0.38, floorHeight * 0.34);
  const windowGeometry = new THREE.BoxGeometry(windowWidth, windowHeight, 0.035);
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: palette.glass,
    roughness: 0.31,
    metalness: 0.12,
    emissive: "#152631",
    emissiveIntensity: 0.12,
  });
  const windowCount = floorCount * (frontColumns * 2 + sideColumns * 2);
  const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, windowCount);
  windows.name = "Presentation neighborhood windows";
  windows.castShadow = false;
  windows.receiveShadow = false;
  const windowTransform = new THREE.Object3D();
  let windowIndex = 0;
  for (let floor = 0; floor < floorCount; floor += 1) {
    const windowY = baseY + topOffset + floorHeight * (floor + 0.54);
    for (const side of [-1, 1]) {
      for (let column = 0; column < frontColumns; column += 1) {
        windowTransform.position.set(
          x - width / 2 + width * (column + 1) / (frontColumns + 1),
          windowY,
          z + side * (depth / 2 + 0.02),
        );
        windowTransform.rotation.set(0, 0, 0);
        windowTransform.updateMatrix();
        windows.setMatrixAt(windowIndex++, windowTransform.matrix);
      }
      for (let column = 0; column < sideColumns; column += 1) {
        windowTransform.position.set(
          x + side * (width / 2 + 0.02),
          windowY,
          z - depth / 2 + depth * (column + 1) / (sideColumns + 1),
        );
        windowTransform.rotation.set(0, Math.PI / 2, 0);
        windowTransform.updateMatrix();
        windows.setMatrixAt(windowIndex++, windowTransform.matrix);
      }
    }
  }
  windows.instanceMatrix.needsUpdate = true;
  root.add(windows);

  if (urban && !mobile) {
    for (let floor = 1; floor < floorCount; floor += 2) {
      addBox(
        root,
        "Presentation urban balcony slab",
        width * 0.92,
        Math.max(0.035, span * 0.006),
        Math.max(0.12, depth * 0.085),
        x,
        baseY + topOffset + floorHeight * floor,
        z + depth / 2 + 0.055,
        "#8a9390",
        { roughness: 0.76, castShadow: false },
      );
    }
  }
}

/**
 * Brings a compact residential neighbourhood into the mid-ground: a small
 * street grid, planted plots, facade windows and variable low-rise/mid-rise
 * massing keep the Building from reading as an isolated object on an empty plane.
 */
function addNeighborhoodContext(
  root: THREE.Group,
  bounds: THREE.Box3,
  center: THREE.Vector3,
  baseY: number,
  span: number,
  margin: number,
  mobile: boolean,
  landscape: PresentationLandscapePreset,
) {
  const urban = landscape === "urban";
  const size = bounds.getSize(new THREE.Vector3());
  const count = urban ? (mobile ? 2 : 4) : (mobile ? 2 : 3);
  const roadWidth = Math.max(span * 0.22, 3.5);
  const roadLength = Math.max(size.z + margin * 5.4, span * 3.2);
  const sideSpacing = Math.max(span * 0.5, roadLength / (count + 1));
  const crossRoads = [-1, 1] as const;

  // Side streets meet the existing front road and provide a legible block grid.
  for (const side of crossRoads) {
    const roadX = center.x + side * (size.x / 2 + margin * 1.45);
    addBox(
      root,
      "Presentation neighborhood road",
      roadWidth,
      0.12,
      roadLength,
      roadX,
      baseY - 0.035,
      center.z,
      "#343a40",
      { roughness: 0.98 },
    );
    const curbWidth = Math.max(span * 0.012, 0.13);
    for (const curbSide of [-1, 1]) {
      addBox(
        root,
        "Presentation neighborhood curb",
        curbWidth,
        Math.max(0.1, span * 0.012),
        roadLength,
        roadX + curbSide * (roadWidth / 2 + curbWidth / 2),
        baseY + 0.035,
        center.z,
        "#d4d0c4",
        { roughness: 0.92 },
      );
    }
    const sidewalkWidth = Math.max(span * 0.075, 1.0);
    for (const sidewalkSide of [-1, 1]) {
      addBox(
        root,
        "Presentation neighborhood sidewalk",
        sidewalkWidth,
        0.08,
        roadLength,
        roadX + sidewalkSide * (roadWidth / 2 + curbWidth + sidewalkWidth / 2),
        baseY - 0.005,
        center.z,
        "#c7c0b3",
        { roughness: 0.96 },
      );
    }
    if (!mobile) {
      const dashCount = 9;
      for (let dash = 0; dash < dashCount; dash += 1) {
        const dashZ = center.z - roadLength * 0.43 + roadLength * 0.86 * dash / (dashCount - 1);
        addBox(
          root,
          "Presentation neighborhood road marking",
          0.07,
          0.018,
          Math.max(0.36, span * 0.055),
          roadX,
          baseY + 0.033,
          dashZ,
          "#d9d5c5",
          { roughness: 0.99 },
        );
      }
    }
  }

  for (const axis of ["x", "z"] as const) {
    const alongSize = axis === "x" ? size.x : size.z;
    for (const side of crossRoads) {
      for (let index = 0; index < count; index += 1) {
        const variation = (index * 3 + (side > 0 ? 2 : 0) + (axis === "x" ? 1 : 0)) % 7;
        const width = span * (urban ? 0.28 + (variation % 3) * 0.045 : 0.21 + (variation % 3) * 0.035);
        const depth = span * (urban ? 0.24 + (variation % 2) * 0.035 : 0.19 + (variation % 2) * 0.035);
        const height = urban
          ? Math.max(span * (0.58 + (variation % 4) * 0.10), 12 + (variation % 4) * 2.5)
          : Math.max(span * (0.24 + (variation % 3) * 0.055), 4.2 + (variation % 3) * 0.9);
        const offset = (index - (count - 1) / 2) * sideSpacing;
        const x = axis === "x"
          ? center.x + offset
          : center.x + side * (size.x / 2 + margin * 2.65 + width / 2);
        const z = axis === "z"
          ? center.z + offset
          : center.z + side * (size.z / 2 + margin * 2.65 + depth / 2);
        const sideInset = alongSize > span * 0.8 ? span * 0.02 : 0;
        const adjustedX = axis === "x" ? x + side * sideInset : x;
        const adjustedZ = axis === "z" ? z + side * sideInset : z;
        addNeighborhoodBuilding(
          root,
          adjustedX,
          adjustedZ,
          width,
          depth,
          height,
          baseY,
          span,
          mobile,
          urban,
          variation,
        );

        const treeHeight = Math.max(span * (urban ? 0.11 : 0.145), urban ? 2.0 : 2.4);
        const crown = Math.max(treeHeight * 0.52, 0.95);
        const treeOffsets = urban ? [0.66] : [-0.66, 0.66];
        for (const treeSide of treeOffsets) {
          addTree(
            root,
            adjustedX + width * treeSide,
            baseY,
            adjustedZ,
            treeHeight,
            crown,
            mobile,
            variation % 2 === 0 ? "#4c7950" : "#578151",
          );
        }
      }
    }
  }
}

export interface PresentationFallbackOptions {
  landscapePreset?: PresentationLandscapePreset;
  includeRoad?: boolean;
  includeCars?: boolean;
  includeSidewalk?: boolean;
  includeDriveway?: boolean;
  includeLawn?: boolean;
  includeTrees?: boolean;
  includePlants?: boolean;
  includeLamps?: boolean;
  includeContextMassing?: boolean;
  /** Do not lay generated ground slabs over site geometry that is in the source model. */
  includeGround?: boolean;
  includeSurroundingGround?: boolean;
}

export function addPresentationFallback(
  root: THREE.Group,
  bounds: THREE.Box3,
  mobile: boolean,
  bulbMaterials: THREE.MeshStandardMaterial[],
  groundElevation = bounds.min.y,
  options: PresentationFallbackOptions = {},
) {
  const landscape = options.landscapePreset === undefined || options.landscapePreset === "auto"
    ? "suburban"
    : options.landscapePreset;
  const includeRoad = options.includeRoad ?? landscape !== "hillside";
  const includeCars = options.includeCars ?? (landscape === "urban" || landscape === "suburban");
  const includeSidewalk = options.includeSidewalk ?? (landscape === "urban" || landscape === "suburban");
  const includeDriveway = options.includeDriveway ?? true;
  const includeLawn = (options.includeLawn ?? true) && landscape !== "rural-farm";
  const includeTrees = options.includeTrees ?? true;
  const includePlants = options.includePlants ?? true;
  const includeLamps = options.includeLamps ?? landscape !== "rural-farm";
  const includeContextMassing = options.includeContextMassing ?? false;
  const includeGround = options.includeGround ?? true;
  const includeSurroundingGround = options.includeSurroundingGround ?? true;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const baseY = groundElevation;
  const span = Math.max(size.x, size.z, size.y * 0.48, 8);
  const margin = Math.max(span * 0.24, 2.8);
  const siteWidth = Math.max(size.x + margin * 2.4, span * 1.9);
  const siteDepth = Math.max(size.z + margin * 2.0, span * 1.7);

  root.name = "presentation-site-environment";
  root.userData.presentationOnly = true;
  root.userData.nonAuthoritative = true;

  if (includeSurroundingGround) {
    addBox(root, "Presentation surrounding ground", siteWidth * 18, 0.1, siteDepth * 18, center.x, baseY - 0.21, center.z, "#89977d", { roughness: 1 });
  }

  if (includeGround) {
    addBox(
      root,
      "Presentation ground",
      siteWidth,
      0.18,
      siteDepth,
      center.x,
      baseY - 0.11,
      center.z,
      "#d7d1c5",
      { roughness: 0.97 },
    );
  }

  const roadDepth = landscape === "rural-farm"
    ? Math.max(span * 0.16, 3.2)
    : Math.max(span * 0.34, 4.8);
  const roadZ = bounds.max.z + margin * 0.58 + roadDepth / 2;
  if (includeRoad) {
    addBox(
      root,
      "Presentation road",
      siteWidth * 8,
      0.12,
      roadDepth,
      center.x,
      baseY - 0.035,
      roadZ,
      "#343a40",
      { roughness: 0.98 },
    );

    for (let i = -25; i <= 25; i++) {
      addBox(root, "Presentation road lane marking", siteWidth * 0.055, 0.02, 0.08, center.x + siteWidth * i * 0.13, baseY + 0.036, roadZ, "#d9d5c5", { roughness: 0.99 });
    }
  }


  const sidewalkDepth = Math.max(span * 0.075, 1.2);
  const sidewalkZ = roadZ - roadDepth / 2 - sidewalkDepth / 2 - 0.18;
  if (includeSidewalk) {
    addBox(
      root,
      "Presentation sidewalk",
      siteWidth * 1.18,
      0.12,
      sidewalkDepth,
      center.x,
      baseY + 0.015,
      sidewalkZ,
      "#c7c0b3",
      { roughness: 0.96 },
    );
  }


  if (includeSidewalk) {
    addBox(root, "Presentation street curb", siteWidth * 1.18, 0.22, 0.18, center.x, baseY + 0.08, sidewalkZ + sidewalkDepth / 2, "#eee9dd", { roughness: 0.92 });
  }


  if (includeCars) {
    addCar(root, center.x + siteWidth * 0.36, baseY + 0.04, roadZ - roadDepth * 0.25, Math.max(span * 0.14, 3.6), "#e3e8e8");
    if (!mobile) addCar(root, center.x - siteWidth * 0.46, baseY + 0.04, roadZ - roadDepth * 0.25, Math.max(span * 0.13, 3.4), "#344c65");
  }


  const driveDepth = Math.max(sidewalkZ - sidewalkDepth / 2 - bounds.max.z, 1.2);
  if (includeDriveway) {
    addBox(
      root,
      "Presentation driveway",
      Math.max(size.x * 0.28, 2.4),
      0.11,
      driveDepth,
      center.x + size.x * 0.16,
      baseY + 0.01,
      bounds.max.z + driveDepth / 2,
      "#b6aea1",
      { roughness: 0.94 },
    );
  }


  const lawnWidth = Math.max(margin * 0.72, 1.8);
  if (includeLawn) {
    addBox(
      root,
      "Presentation lawn left",
      lawnWidth,
      0.08,
      Math.max(siteDepth - roadDepth * 0.9, 3),
      bounds.min.x - lawnWidth / 2 - margin * 0.16,
      baseY - 0.005,
      center.z - margin * 0.12,
      "#5e8056",
      { roughness: 0.99 },
    );
    addBox(
      root,
      "Presentation lawn right",
      lawnWidth,
      0.08,
      Math.max(siteDepth - roadDepth * 0.9, 3),
      bounds.max.x + lawnWidth / 2 + margin * 0.16,
      baseY - 0.005,
      center.z - margin * 0.12,
      "#5e8056",
      { roughness: 0.99 },
    );
  }


  if (includeTrees) {
    const treeHeight = Math.max(size.y * 0.17, 2.8);
    const crownWidth = Math.max(treeHeight * 0.5, 1.4);
    const treeZs = [
      bounds.min.z + size.z * 0.08,
      center.z,
      bounds.max.z - size.z * 0.08,
    ];
    for (const z of treeZs) {
      addTree(root, bounds.min.x - margin * 0.62, baseY, z, treeHeight, crownWidth, mobile, "#4c7b50");
      addTree(root, bounds.max.x + margin * 0.62, baseY, z, treeHeight * 0.92, crownWidth * 0.9, mobile, "#567f4e");
    }

    const frontTreeZ = sidewalkZ - sidewalkDepth * 0.2;
    for (const offset of [-0.36, 0.36]) {
      addTree(
        root,
        center.x + siteWidth * offset,
        baseY,
        frontTreeZ,
        treeHeight * 0.82,
        crownWidth * 0.82,
        mobile,
        "#4f8257",
      );
    }
  }


  if (includePlants) {
    const plantZ = bounds.max.z + Math.max(margin * 0.12, 0.9);
    for (const offset of [-0.34, -0.12, 0.12, 0.34]) {
      addPlant(
        root,
        center.x + size.x * offset,
        baseY,
        plantZ,
        Math.max(span * 0.055, 0.55),
        Math.max(span * 0.07, 0.75),
        mobile,
        offset < 0 ? "#4c8d5b" : "#5c9458",
      );
    }
  }


  if (includeLamps) {
    const lampHeight = Math.max(size.y * 0.13, 2.5);
    for (const offset of [-0.32, 0, 0.32]) {
      addLamp(
        root,
        center.x + siteWidth * offset,
        baseY,
        sidewalkZ,
        lampHeight,
        mobile,
        bulbMaterials,
      );
    }
  }


  if (landscape === "rural-farm") {
    addFarmFields(root, bounds, mobile, baseY, span, margin);
  }

  if (landscape === "hillside") {
    addHillsideBackdrop(root, center, baseY, span, mobile);
  }

  if (landscape === "urban" || landscape === "suburban") {
    addNeighborhoodContext(root, bounds, center, baseY, span, margin, mobile, landscape);
    addUrbanContext(root, center, baseY, span, mobile);
  }

  if (includeContextMassing && !mobile) {
    const contextZ = bounds.min.z - margin * 4.0;
    const contextHeight = Math.max(size.y * 0.18, 2.4);
    for (const offset of [-0.65, -0.30, 0, 0.35, 0.7]) {
      addBox(
        root,
        "Presentation context massing",
        Math.max(span * 0.18, 2.8),
        contextHeight * (offset === 0 ? 1.15 : 0.82),
        Math.max(span * 0.15, 2.4),
        center.x + siteWidth * offset,
        baseY + (contextHeight * (offset === 0 ? 1.15 : 0.82)) / 2,
        contextZ,
        "#a9afb0",
        { roughness: 0.97, opacity: 1 },
      );
    }
  }
}

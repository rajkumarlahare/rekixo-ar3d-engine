import * as THREE from "three";
import { sourceTextureData } from "./sourceTextureData";
import type { ExperienceFeature, ExperienceMode } from "./experienceTypes";
import interiorScene from "../../../../project-profiles/jyoti-paradise/interior-scene-v2.json";

function sourceFinish(key: string, color: number, roughness: number) {
  const material = standard(color, roughness);
  const data = sourceTextureData[key];
  if (data) {
    const texture = new THREE.TextureLoader().load(data);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    material.map = texture;
  }
  return material;
}


function standard(color: number, roughness = 0.72, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function glass(color = 0x9fc8d9, opacity = 0.58) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.12,
    metalness: 0.02,
    transmission: 0.16,
    transparent: true,
    opacity,
    depthWrite: false,
    clearcoat: 0.5,
  });
}

function box(
  size: [number, number, number],
  material: THREE.Material,
  position: [number, number, number],
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function tagFeature(
  features: ExperienceFeature[],
  object: THREE.Object3D,
  id: string,
  label: string,
  category: string,
  description: string,
) {
  object.userData.experienceFeatureId = id;
  object.userData.experienceLabel = label;
  object.userData.experienceCategory = category;
  features.push({ id, label, category, description, object });
  return object;
}

function addFeature(
  root: THREE.Object3D,
  features: ExperienceFeature[],
  object: THREE.Object3D,
  id: string,
  label: string,
  category: string,
  description: string,
) {
  tagFeature(features, object, id, label, category, description);
  root.add(object);
}

function makeConifer(height: number) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.045, height * 0.065, height * 0.34, 9),
    standard(0x6c4932, 0.94),
  );
  trunk.position.y = height * 0.17;
  trunk.castShadow = true;
  group.add(trunk);

  const leaf = standard(0x315e35, 0.96);
  for (const [y, radius] of [
    [0.34, 0.22],
    [0.49, 0.26],
    [0.64, 0.22],
    [0.78, 0.16],
  ] as Array<[number, number]>) {
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(height * radius, height * 0.32, 12),
      leaf,
    );
    crown.position.y = height * y;
    crown.castShadow = true;
    group.add(crown);
  }
  return group;
}

function makeFlowerStrip(width: number) {
  const root = new THREE.Group();
  root.add(box([width, 0.16, 0.55], standard(0x5b3a28, 0.96), [0, 0.08, 0]));
  const colors = [0xea4f73, 0xf6c54b, 0xf07c49, 0xbf5ce8, 0xffffff];
  for (let i = 0; i < 18; i += 1) {
    const x = -width * 0.47 + (width * 0.94 * i) / 17;
    const flower = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 8, 7),
      standard(colors[i % colors.length], 0.7),
    );
    flower.position.set(x, 0.26 + (i % 2) * 0.025, ((i % 3) - 1) * 0.12);
    root.add(flower);
  }
  return root;
}

function makeRoad(width: number, depth: number) {
  const group = new THREE.Group();
  const asphalt = box([width, 0.09, depth], standard(0x3a3d40, 0.94), [0, 0.045, 0]);
  group.add(asphalt);

  const sidewalkMat = standard(0xb8afa2, 0.86);
  const curbMat = standard(0xd8d2c8, 0.78);
  for (const side of [-1, 1]) {
    const z = side * (depth / 2 + 0.58);
    group.add(
      box([width, 0.13, 0.9], sidewalkMat, [0, 0.075, z]),
      box([width, 0.22, 0.14], curbMat, [0, 0.11, side * (depth / 2 + 0.08)]),
    );
  }

  const markingMat = standard(0xf0ede7, 0.72);
  for (let x = -width * 0.4; x <= width * 0.4; x += Math.max(width * 0.12, 2.4)) {
    const stripe = box([Math.max(width * 0.055, 1.2), 0.018, 0.075], markingMat, [x, 0.105, 0]);
    group.add(stripe);
  }
  return group;
}

function makeGate(width: number, height: number) {
  const root = new THREE.Group();
  const metal = standard(0x55483f, 0.38, 0.34);
  for (const side of [-1, 1]) {
    const panel = box([width * 0.47, height, 0.1], metal, [side * width * 0.245, height / 2, 0]);
    root.add(panel);
    for (let i = -3; i <= 3; i += 1) {
      root.add(
        box(
          [0.035, height * 0.76, 0.03],
          standard(0xc5a67b, 0.38, 0.42),
          [side * width * 0.245 + i * width * 0.055, height * 0.52, 0.07],
        ),
      );
    }
  }
  return root;
}

function addLowRoom(
  root: THREE.Object3D,
  features: ExperienceFeature[],
  id: string,
  label: string,
  unit: string,
  size: [number, number],
  pos: [number, number],
  floorMat: THREE.Material,
  description: string,
  wallHeight = 0.55,
) {
  const [w, d] = size;
  const [x, z] = pos;
  const group = new THREE.Group();
  const floor = box([w, 0.12, d], floorMat, [x, 0.06, z]);
  tagFeature(features, floor, id, label, `Flat ${unit}`, description);
  group.add(floor);

  const wallMat = standard(0xe8e5de, 0.86);
  wallMat.side = THREE.DoubleSide;
  // Full-height walls in walk mode, cutaway walls in the plan. Door placement
  // is reconstructed, not surveyed: keep an open 0.86m entrance on the south.
  const doorWidth = Math.min(0.86, w * 0.65);
  const sideWidth = (w - doorWidth) / 2;
  const walls = [
    box([sideWidth, 2.75, 0.12], wallMat, [x - (w + doorWidth) / 4, 1.375, z - d / 2]),
    box([sideWidth, 2.75, 0.12], wallMat, [x + (w + doorWidth) / 4, 1.375, z - d / 2]),
    box([doorWidth, 0.6, 0.12], wallMat, [x, 2.45, z - d / 2]),
    box([w, 2.75, 0.12], wallMat, [x, 1.375, z + d / 2]),
    box([0.12, 2.75, d], wallMat, [x - w / 2, 1.375, z]),
    box([0.12, 2.75, d], wallMat, [x + w / 2, 1.375, z]),
  ];
  for (const wall of walls) {
    wall.userData.walkWall = true;
    wall.userData.fullY = wall.position.y;
    wall.userData.cutawayHeight = wallHeight;
    group.add(wall);
  }
  const ceiling = box([w, 0.06, d], standard(0xf4f1e9, 0.9), [x, 2.8, z]);
  ceiling.userData.walkCeiling = true;
  group.add(ceiling);
  const frameMat = standard(0x795339, 0.52);
  for (const side of [-1, 1]) {
    const frame = box([0.055, 2.16, 0.16], frameMat, [x + side * doorWidth / 2, 1.08, z - d / 2]);
    frame.userData.walkCeiling = true;
    group.add(frame);
  }
  root.add(group);
  return { root: group, x, z, w, d };
}

function addBed(root: THREE.Object3D, x: number, z: number, rotate = 0) {
  const group = new THREE.Group();
  const wood = standard(0x6f503d, 0.58);
  const linen = standard(0xf4eee7, 0.88);
  const accent = standard(0xb47a82, 0.86);
  group.add(
    box([1.75, 0.25, 2.0], wood, [0, 0.18, 0]),
    box([1.62, 0.22, 1.86], linen, [0, 0.42, 0]),
    box([1.62, 0.07, 0.62], accent, [0, 0.56, -0.15]),
    box([0.64, 0.16, 0.38], linen, [-0.42, 0.62, 0.58]),
    box([0.64, 0.16, 0.38], linen, [0.42, 0.62, 0.58]),
  );
  group.position.set(x, 0, z);
  group.rotation.y = rotate;
  root.add(group);
}

function addSofa(root: THREE.Object3D, x: number, z: number, width: number, rotate = 0) {
  const group = new THREE.Group();
  const fabric = standard(0xc8b5a0, 0.88);
  group.add(
    box([width, 0.42, 0.75], fabric, [0, 0.26, 0]),
    box([width, 0.52, 0.16], fabric, [0, 0.58, 0.28]),
    box([0.18, 0.52, 0.72], fabric, [-width / 2 + 0.09, 0.48, 0]),
    box([0.18, 0.52, 0.72], fabric, [width / 2 - 0.09, 0.48, 0]),
  );
  group.position.set(x, 0, z);
  group.rotation.y = rotate;
  root.add(group);
}

function addWardrobe(root: THREE.Object3D, x: number, z: number, width: number, rotate = 0) {
  const group = new THREE.Group();
  const body = standard(0x78553e, 0.62);
  group.add(box([width, 1.85, 0.48], body, [0, 0.94, 0]));
  for (const dx of [-width * 0.24, 0, width * 0.24]) {
    group.add(box([0.018, 1.62, 0.505], standard(0xa57a59, 0.58), [dx, 0.96, 0.01]));
  }
  group.position.set(x, 0, z);
  group.rotation.y = rotate;
  root.add(group);
}

function addLShapeSofa(root: THREE.Object3D, x: number, z: number, rotate = 0) {
  const group = new THREE.Group();
  const fabric = standard(0xb9a895, 0.9);
  group.add(
    box([2.5, 0.42, 0.74], fabric, [0, 0.26, 0]),
    box([0.74, 0.42, 1.65], fabric, [-0.88, 0.26, 0.48]),
    box([2.5, 0.48, 0.16], fabric, [0, 0.58, 0.29]),
    box([0.16, 0.48, 1.65], fabric, [-1.17, 0.58, 0.48]),
  );
  group.position.set(x, 0, z);
  group.rotation.y = rotate;
  root.add(group);
}

function addKitchen(root: THREE.Object3D, x: number, z: number, width: number, rotate = 0) {
  const group = new THREE.Group();
  const cabinet = standard(0x805d43, 0.58);
  const counter = standard(0x2e3032, 0.28);
  group.add(
    box([width, 0.82, 0.55], cabinet, [0, 0.44, 0]),
    box([width, 0.08, 0.62], counter, [0, 0.89, 0]),
  );
  for (const off of [-width * 0.25, width * 0.22]) {
    const sink = box([0.5, 0.025, 0.34], standard(0xc4c9cc, 0.2, 0.45), [off, 0.94, 0]);
    group.add(sink);
  }
  group.position.set(x, 0, z);
  group.rotation.y = rotate;
  root.add(group);
}

function addDining(root: THREE.Object3D, x: number, z: number, rotate = 0) {
  const group = new THREE.Group();
  const wood = standard(0x9a6d4d, 0.58);
  group.add(box([1.15, 0.12, 0.72], wood, [0, 0.66, 0]));
  for (const [cx, cz] of [[-0.72, 0], [0.72, 0], [0, -0.52], [0, 0.52]] as Array<[number, number]>) {
    group.add(box([0.38, 0.58, 0.38], standard(0xc2a17f, 0.78), [cx, 0.3, cz]));
  }
  group.position.set(x, 0, z);
  group.scale.set(0.48, 1, 0.48);
  group.rotation.y = rotate;
  root.add(group);
}

function addToilet(root: THREE.Object3D, x: number, z: number, rotate = 0) {
  const group = new THREE.Group();
  const porcelain = standard(0xf4f6f5, 0.32);
  const toilet = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 0.48, 16), porcelain);
  toilet.position.set(0.2, 0.27, 0);
  group.add(toilet);
  group.add(box([0.42, 0.18, 0.34], porcelain, [-0.35, 0.46, 0]));
  group.position.set(x, 0, z);
  group.rotation.y = rotate;
  root.add(group);
}

function addBalcony(
  root: THREE.Object3D,
  features: ExperienceFeature[],
  id: string,
  label: string,
  unit: string,
  size: [number, number],
  pos: [number, number],
  railSide: "left" | "right" | "top" | "bottom",
) {
  const [w, d] = size;
  const [x, z] = pos;
  const deck = box([w, 0.12, d], standard(0xbda88d, 0.76), [x, 0.06, z]);
  tagFeature(features, deck, id, label, `Flat ${unit}`, `${label} shown from the brochure-backed unit layout.`);
  root.add(deck);

  const rail = glass(0x9fc3d2, 0.68);
  const horizontal = railSide === "top" || railSide === "bottom";
  const railSize: [number, number, number] = horizontal ? [w, 0.66, 0.055] : [0.055, 0.66, d];
  const railPos: [number, number, number] =
    railSide === "top" ? [x, 0.38, z + d / 2] :
    railSide === "bottom" ? [x, 0.38, z - d / 2] :
    railSide === "left" ? [x - w / 2, 0.38, z] :
    [x + w / 2, 0.38, z];
  root.add(box(railSize, rail, railPos));

  // Balcony planters are visible in the supplied brochure renders.
  const planter = standard(0x6a4634, 0.9);
  const green = standard(0x477a44, 0.94);
  for (const offset of [-0.28, 0.28]) {
    const px = horizontal ? x + offset * w : x + (railSide === "left" ? -0.32 : 0.32) * w;
    const pz = horizontal ? z + (railSide === "bottom" ? -0.3 : 0.3) * d : z + offset * d;
    root.add(
      box([0.22, 0.24, 0.22], planter, [px, 0.18, pz]),
      box([0.18, 0.28, 0.18], green, [px, 0.42, pz]),
    );
  }
}

function makeBrochureTypicalFloor(features: ExperienceFeature[]) {
  const root = new THREE.Group();
  root.name = "source-evidenced-typical-floor";

  const finishes: Record<string, THREE.Material> = {
    living: sourceFinish("Marble_Carrara_Floor_Tile", 0xe7dfd3, 0.56),
    bath: sourceFinish("Slate", 0x74777a, 0.7),
    kitchen: sourceFinish("Basic_Tile", 0xd0c3ae, 0.62),
    lobby: standard(0xd9d1c4, 0.74),
    duct: standard(0x96999b, 0.92),
    balcony: standard(0xcfc7bb, 0.78),
  };

  const unitLabels = new Map(
    interiorScene.units.map((unit) => [
      unit.id,
      unit.id === "unit-common"
        ? "Common"
        : unit.name.replace(/\s+series$/i, "").replaceAll("–", "-"),
    ]),
  );

  for (const room of interiorScene.rooms) {
    if (room.boundary.kind !== "rectangle") continue;
    const size = room.boundary.size as [number, number];
    const position = room.boundary.center as [number, number];
    const materialId = room.finish?.materialId ?? "living";
    const material = finishes[materialId] ?? finishes.living;
    const unit = unitLabels.get(room.unitId ?? "") ?? "Common";
    const description =
      room.evidence.basis ??
      room.evidence.sourceNote ??
      "Source-evidenced project space.";

    if (materialId === "balcony") {
      const railSide =
        room.id === "103-wbal" || room.id === "103-balcony"
          ? "bottom"
          : position[0] < 0
            ? "left"
            : "right";
      addBalcony(
        root,
        features,
        room.id,
        room.name,
        unit,
        size,
        position,
        railSide,
      );
      continue;
    }

    const wallHeight =
      room.id === "duct" || room.id === "fire-lift" ? 0.78 : 0.72;
    addLowRoom(
      root,
      features,
      room.id,
      room.name,
      unit,
      size,
      position,
      material,
      description,
      wallHeight,
    );
  }

  // Presentation furniture remains deliberately non-authoritative. The room
  // rectangles above come from Scene Manifest V2 data; these movable props do
  // not become source evidence or semantic room bindings.
  addSofa(root, -4.6, 0.2, 2.45, 0);
  addDining(root, -2.67, 2.037, 0);
  addKitchen(root, -5.5, 3.3, 2.55, 0);
  addBed(root, -6.24, 5.55, 0);
  addWardrobe(root, -7.73, 5.9, 1.45, Math.PI / 2);
  addBed(root, -2.65, 7.2, 0);
  addWardrobe(root, -3.3, 8.35, 1.5, 0);
  addToilet(root, -1.5, 4.2, 0);
  addToilet(root, -6.2, 8.1, 0);

  addSofa(root, 4.5, 0.2, 2.35, Math.PI);
  addDining(root, 2.67, 2.037, 0);
  addKitchen(root, 5.5, 3.25, 2.55, Math.PI);
  addBed(root, 6.225, 5.55, Math.PI);
  addWardrobe(root, 7.7, 5.9, 1.45, Math.PI / 2);
  addBed(root, 2.675, 7.1, Math.PI);
  addWardrobe(root, 3.3, 8.2, 1.5, 0);
  addToilet(root, 1.55, 4.2, Math.PI);
  addToilet(root, 6.2, 8.1, Math.PI);

  const stair = new THREE.Group();
  for (let i = 0; i < 10; i += 1) {
    stair.add(
      box(
        [2.4, 0.1 + i * 0.035, 0.31],
        standard(0x595d60, 0.78),
        [-3.45, 0.08 + i * 0.04, -3.15 + i * 0.3],
      ),
    );
  }
  const stairPick = box(
    [2.6, 0.1, 3.2],
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
    [-3.45, 0.05, -1.85],
  );
  tagFeature(
    features,
    stairPick,
    "stair",
    "Staircase",
    "Common",
    "Staircase presentation remains reconstructed until a source opening/circulation boundary is semantically reviewed.",
  );
  stair.add(stairPick);
  root.add(stair);

  addLShapeSofa(root, -1.6, -5.3, Math.PI / 2);
  addKitchen(root, -2.013, -7.45, 3.0, 0);
  addBed(root, 3.313, -5.4, Math.PI / 2);
  addWardrobe(root, 4.65, -4.95, 1.45, Math.PI / 2);
  addBed(root, 3.515, -8.8, Math.PI / 2);
  addWardrobe(root, 4.72, -8.1, 1.6, Math.PI / 2);
  addToilet(root, 0.88, -7.7, 0);

  const overall = box(
    [18.6, 0.045, 20.6],
    standard(0xcfc7bb, 0.94),
    [0, -0.03, -0.55],
  );
  overall.renderOrder = -1;
  root.add(overall);

  return root;
}

function makeRoofOverlay(bounds: THREE.Box3, features: ExperienceFeature[]) {
  const root = new THREE.Group();
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const y = bounds.max.y + Math.max(size.y * 0.004, 0.06);
  const roof = box(
    [size.x * 0.88, 0.08, size.z * 0.84],
    standard(0xdad7d0, 0.82),
    [center.x, y, center.z],
  );
  tagFeature(features, roof, "roof", "Roof / Terrace", "Building", "Source-faithful roof inspection. No recreational roof amenity is claimed by the supplied brochure.");
  root.add(roof);

  const glow = new THREE.MeshStandardMaterial({
    color: 0xffdfb0,
    emissive: 0xff9f4a,
    emissiveIntensity: 2.2,
    roughness: 0.35,
  });
  root.add(
    box([size.x * 0.72, 0.035, 0.035], glow, [center.x, y + 0.09, center.z + size.z * 0.39]),
    box([0.035, 0.035, size.z * 0.55], glow, [center.x + size.x * 0.42, y + 0.09, center.z + size.z * 0.06]),
  );
  return root;
}

function addFacadeWarmLights(root: THREE.Object3D, bounds: THREE.Box3, mobile: boolean) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xfff0d9,
    emissive: 0xffb66e,
    emissiveIntensity: 2.8,
    roughness: 0.34,
  });
  const floors = [0.23, 0.36, 0.49, 0.62, 0.75, 0.88];
  for (const ratio of floors) {
    const y = bounds.min.y + size.y * ratio;
    for (const xRatio of [-0.32, 0.02, 0.34]) {
      // Recessed facade pin-lights: intentionally tiny so they read like the
      // brochure render instead of floating white locator spheres.
      const fixtureRadius = Math.min(Math.max(size.x * 0.0018, 0.022), 0.042);
      const fixture = new THREE.Mesh(new THREE.SphereGeometry(fixtureRadius, 8, 6), lightMat);
      fixture.position.set(center.x + size.x * xRatio, y, bounds.max.z + Math.max(size.z * 0.006, 0.025));
      root.add(fixture);
    }
  }

  for (const xRatio of [-0.28, 0.26]) {
    const light = new THREE.PointLight(
      0xffb56d,
      mobile ? 0.82 : 1.55,
      Math.max(size.x * 0.58, 8),
      2,
    );
    light.position.set(
      center.x + size.x * xRatio,
      bounds.min.y + size.y * 0.50,
      bounds.max.z + Math.max(size.z * 0.14, 0.95),
    );
    root.add(light);
  }
}


function addBrickFacing(
  root: THREE.Object3D,
  centerX: number,
  centerY: number,
  z: number,
  width: number,
  height: number,
) {
  const brick = standard(0xb75f49, 0.88);
  const mortar = standard(0xd9b6a5, 0.92);
  root.add(box([width, height, 0.06], brick, [centerX, centerY, z]));

  const rows = 5;
  for (let row = 1; row < rows; row += 1) {
    root.add(
      box(
        [width, 0.018, 0.072],
        mortar,
        [centerX, centerY - height / 2 + (height * row) / rows, z + 0.04],
      ),
    );
  }

  const columns = Math.max(6, Math.round(width / Math.max(height * 0.55, 0.4)));
  for (let col = 1; col < columns; col += 1) {
    const x = centerX - width / 2 + (width * col) / columns;
    const stagger = col % 2 === 0 ? height * 0.1 : -height * 0.1;
    root.add(
      box(
        [0.014, height * 0.2, 0.074],
        mortar,
        [x, centerY + stagger, z + 0.041],
      ),
    );
  }
}

function dispose(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    }
  });
}

export function createJyotiProjectExperience(bounds: THREE.Box3, mobile: boolean, referenceVisual = false, preserveSourceSite = false) {
  const root = new THREE.Group();
  root.name = "source-faithful-project-experience";

  const siteRoot = new THREE.Group();
  const interiorRoot = new THREE.Group();
  const terraceRoot = new THREE.Group();
  root.add(siteRoot, interiorRoot, terraceRoot);

  const features: ExperienceFeature[] = [];
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const spanX = Math.max(size.x, 12);
  const spanZ = Math.max(size.z, 10);
  const baseY = bounds.min.y - Math.max(size.y * 0.006, 0.04);

  // Imported site geometry already contains the authored parcel, boundary and
  // entrance. Never surround it with a second, bounds-scaled compound.
  if (!preserveSourceSite) {
  // Presentation context for legacy models without an authored site.
  const plot = box(
    [spanX * (referenceVisual ? 1.28 : 1.68), 0.14, spanZ * (referenceVisual ? 1.16 : 1.48)],
    standard(referenceVisual ? 0x8f8983 : 0xc5bbae, 0.92),
    [center.x, baseY - 0.06, center.z],
  );
  addFeature(siteRoot, features, plot, "plot", "Project Plot", "Site", "Project parcel shown as a compact paved residential site around the building.");

  const parking = box(
    [spanX * (referenceVisual ? 1.06 : 1.35), 0.09, spanZ * (referenceVisual ? 0.38 : 0.58)],
    standard(referenceVisual ? 0x625f5b : 0x918a82, 0.9),
    [center.x, baseY + 0.02, center.z + spanZ * 0.18],
  );
  addFeature(siteRoot, features, parking, "parking", "Car Parking", "Amenity", "Car Parking is explicitly listed in the supplied project brochure.");

  const road = makeRoad(
    spanX * (referenceVisual ? 1.72 : 2.35),
    Math.max(spanZ * (referenceVisual ? 0.30 : 0.42), referenceVisual ? 3.8 : 5.2),
  );
  road.position.set(
    center.x,
    baseY + 0.04,
    bounds.max.z + spanZ * (referenceVisual ? 0.34 : 0.52),
  );
  addFeature(siteRoot, features, road, "road", "Front Road", "Site", "Road/approach context in front of the project.");

  const flower = makeFlowerStrip(Math.max(spanX * 0.92, 6));
  flower.position.set(center.x, baseY + 0.06, bounds.max.z + spanZ * 0.17);
  addFeature(siteRoot, features, flower, "landscape", "Front Landscaping", "Landscape", "Shrubs and flower strip following the exterior render intent.");

  const treeLayout: Array<[number, number, number]> = referenceVisual
    ? []
    : (!mobile
        ? [
            [-0.56, 0.46, 2.5],
            [-0.32, 0.48, 2.15],
            [-0.08, 0.49, 2.05],
            [0.18, 0.48, 2.15],
            [0.44, 0.45, 2.45],
            [-0.72, -0.34, 3.15],
            [0.72, -0.34, 3.1],
          ]
        : []);

  for (const [xRatio, zRatio, h] of treeLayout) {
    const tree = makeConifer(h);
    tree.position.set(center.x + spanX * xRatio, baseY + 0.04, center.z + spanZ * zRatio);
    siteRoot.add(tree);
  }

  const boundaryMat = standard(0xb8684f, 0.84);
  const capMat = standard(0xeee5da, 0.72);
  const wallH = 0.85;
  const wallDepth = spanZ * 1.4;
  for (const x of [center.x - spanX * 0.82, center.x + spanX * 0.82]) {
    siteRoot.add(
      box([0.18, wallH, wallDepth], boundaryMat, [x, baseY + wallH / 2, center.z - spanZ * 0.03]),
      box([0.22, 0.09, wallDepth], capMat, [x, baseY + wallH + 0.045, center.z - spanZ * 0.03]),
    );
  }
  siteRoot.add(
    box([spanX * 1.64, wallH, 0.18], boundaryMat, [center.x, baseY + wallH / 2, center.z - spanZ * 0.73]),
    box([spanX * 1.64, 0.09, 0.22], capMat, [center.x, baseY + wallH + 0.045, center.z - spanZ * 0.73]),
  );

  const frontZ = center.z + spanZ * 0.70;
  const gateWidth = Math.max(spanX * 0.46, 4.4);
  const sideWidth = (spanX * 1.64 - gateWidth) / 2;
  siteRoot.add(
    box([sideWidth, wallH, 0.18], boundaryMat, [center.x - gateWidth / 2 - sideWidth / 2, baseY + wallH / 2, frontZ]),
    box([sideWidth, wallH, 0.18], boundaryMat, [center.x + gateWidth / 2 + sideWidth / 2, baseY + wallH / 2, frontZ]),
  );
  const gate = makeGate(gateWidth, 1.45);
  gate.position.set(center.x, baseY, frontZ);
  addFeature(siteRoot, features, gate, "gate", "Main Gate", "Site", "Decorative front gate matching the exterior-render treatment.");

  if (referenceVisual) {
    addBrickFacing(
      siteRoot,
      center.x - gateWidth / 2 - sideWidth / 2,
      baseY + wallH / 2,
      frontZ + 0.095,
      sideWidth * 0.98,
      wallH * 0.92,
    );
    addBrickFacing(
      siteRoot,
      center.x + gateWidth / 2 + sideWidth / 2,
      baseY + wallH / 2,
      frontZ + 0.095,
      sideWidth * 0.98,
      wallH * 0.92,
    );
  }

  }

  // Authored facade fixtures are attached to actual balcony ceilings.
  if (!preserveSourceSite) addFacadeWarmLights(siteRoot, bounds, mobile);

  const interior = makeBrochureTypicalFloor(features);
  const floorScale = Math.min(
    (spanX * 1.25) / 18.6,
    (spanZ * 1.35) / 20.0,
    1.15,
  );
  interior.scale.setScalar(floorScale);
  interior.position.set(center.x, baseY + 0.14, center.z - spanZ * 0.02);
  interiorRoot.add(interior);

  const roof = makeRoofOverlay(bounds, features);
  terraceRoot.add(roof);

  interiorRoot.visible = false;
  terraceRoot.visible = false;

  const setWalk = (walking: boolean) => {
    interiorRoot.traverse((object) => {
      if (object.userData.walkWall) {
        object.scale.y = walking ? 1 : object.userData.cutawayHeight / 2.75;
        object.position.y = object.userData.fullY * object.scale.y;
      }
      if (object.userData.walkCeiling) object.visible = walking;
    });
    root.updateMatrixWorld(true);
  };
  setWalk(false);

  return {
    root,
    features,
    setWalk,
    interiorScale: floorScale,
    rooms: features.filter((feature) =>
      /^(101-|102-|103-|lobby$|common-toilet$)/.test(feature.id)),
    roomEntry(id: string) {
      const feature = features.find((item) => item.id === id);
      if (!feature) return undefined;
      root.updateMatrixWorld(true);
      const roomBox = new THREE.Box3().setFromObject(feature.object);
      const point = roomBox.getCenter(new THREE.Vector3());
      point.y = roomBox.max.y + 1.6 * floorScale;
      point.z = roomBox.min.z + Math.min(0.48 * floorScale, (roomBox.max.z - roomBox.min.z) / 3);
      return { point, bounds: roomBox, scale: floorScale };
    },
    setMode(mode: ExperienceMode) {
      siteRoot.visible = mode === "site";
      interiorRoot.visible = mode === "interior";
      terraceRoot.visible = mode === "terrace";
    },
    setNight(night: boolean) {
      siteRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        if (material instanceof THREE.MeshStandardMaterial && material.emissive) {
          material.emissiveIntensity = night
            ? Math.max(material.emissiveIntensity, 2.4)
            : Math.min(material.emissiveIntensity, 0.8);
        }
      });
    },
    focus(mode: ExperienceMode) {
      if (mode === "interior") {
        const box3 = new THREE.Box3().setFromObject(interiorRoot);
        return { box: box3, target: box3.getCenter(new THREE.Vector3()) };
      }
      if (mode === "terrace") {
        const box3 = new THREE.Box3().setFromObject(terraceRoot);
        return { box: box3, target: box3.getCenter(new THREE.Vector3()) };
      }
      const box3 = preserveSourceSite ? bounds.clone() : new THREE.Box3().setFromObject(siteRoot);
      return { box: box3, target: box3.getCenter(new THREE.Vector3()) };
    },
    dispose() {
      dispose(root);
    },
  };
}

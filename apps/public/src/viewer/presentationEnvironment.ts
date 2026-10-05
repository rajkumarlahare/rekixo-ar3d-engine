import * as THREE from "three";

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
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      Math.max(width, 0.02),
      Math.max(height, 0.02),
      Math.max(depth, 0.02),
    ),
    material(
      color,
      options.roughness ?? 0.84,
      options.metalness ?? 0,
      options.opacity ?? 1,
    ),
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
  const geometry = new THREE.IcosahedronGeometry(1, 1);
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
    new THREE.IcosahedronGeometry(1, mobile ? 0 : 1),
    material(color, 0.96),
  );
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

export function addPresentationFallback(
  root: THREE.Group,
  bounds: THREE.Box3,
  mobile: boolean,
  bulbMaterials: THREE.MeshStandardMaterial[],
) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const baseY = bounds.min.y;
  const span = Math.max(size.x, size.z, size.y * 0.48, 8);
  const margin = Math.max(span * 0.24, 2.8);
  const siteWidth = Math.max(size.x + margin * 2.4, span * 1.9);
  const siteDepth = Math.max(size.z + margin * 2.0, span * 1.7);

  root.name = "presentation-site-environment";
  root.userData.presentationOnly = true;
  root.userData.nonAuthoritative = true;

  addBox(root, "Presentation surrounding ground", siteWidth * 18, 0.1, siteDepth * 18, center.x, baseY - 0.21, center.z, "#89977d", { roughness: 1 });

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

  const roadDepth = Math.max(span * 0.34, 4.8);
  const roadZ = bounds.max.z + margin * 0.58 + roadDepth / 2;
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

  const sidewalkDepth = Math.max(span * 0.075, 1.2);
  const sidewalkZ = roadZ - roadDepth / 2 - sidewalkDepth / 2 - 0.18;
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

  addBox(root, "Presentation street curb", siteWidth * 1.18, 0.22, 0.18, center.x, baseY + 0.08, sidewalkZ + sidewalkDepth / 2, "#eee9dd", { roughness: 0.92 });
  addCar(root, center.x + siteWidth * 0.36, baseY + 0.04, roadZ - roadDepth * 0.25, Math.max(span * 0.14, 3.6), "#e3e8e8");
  if (!mobile) addCar(root, center.x - siteWidth * 0.46, baseY + 0.04, roadZ - roadDepth * 0.25, Math.max(span * 0.13, 3.4), "#344c65");
  const driveDepth = Math.max(sidewalkZ - sidewalkDepth / 2 - bounds.max.z, 1.2);
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

  const lawnWidth = Math.max(margin * 0.72, 1.8);
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

  if (!mobile) {
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


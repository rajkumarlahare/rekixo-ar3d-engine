import type { PublicSiteElement } from "@rekixo/3d-contracts";
import * as THREE from "three";
import { getPublicRuntimeSiteElements } from "./publicRuntimeContext";

const AREA_KINDS = new Set<PublicSiteElement["kind"]>([
  "garden",
  "lawn",
  "path",
  "road",
  "parking",
]);

const STRUCTURAL_KINDS = new Set<PublicSiteElement["kind"]>([
  "column",
  "beam",
  "slab",
  "roof",
  "duct",
  "balcony",
  "boundary",
  "stair",
  "lift",
]);

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
  const crown = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, mobile ? 0 : 1),
    material(color, 0.96),
  );
  crown.scale.set(crownWidth * 0.5, crownHeight * 0.5, crownWidth * 0.5);
  crown.position.y = trunkHeight * 0.78 + crownHeight * 0.44;
  crown.castShadow = !mobile;
  crown.receiveShadow = true;
  tree.add(crown);

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

function addGate(
  root: THREE.Group,
  item: PublicSiteElement,
  mobile: boolean,
) {
  const group = new THREE.Group();
  group.name = "Site gate";
  group.position.set(item.x, item.y, item.z);
  group.rotation.y = THREE.MathUtils.degToRad(item.rotation);
  const gateMaterial = material(item.color, 0.48, 0.32);
  const postWidth = Math.max(0.08, Math.min(0.22, item.width * 0.06));
  const depth = Math.max(0.08, item.depth);
  const parts = [
    { width: postWidth, height: item.height, x: -item.width / 2 + postWidth / 2, y: item.height / 2 },
    { width: postWidth, height: item.height, x: item.width / 2 - postWidth / 2, y: item.height / 2 },
    { width: Math.max(postWidth, item.width - postWidth * 2), height: Math.max(0.06, item.height * 0.07), x: 0, y: item.height * 0.82 },
  ];
  for (const part of parts) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(part.width, part.height, depth),
      gateMaterial,
    );
    mesh.position.set(part.x, part.y, 0);
    mesh.castShadow = !mobile;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  root.add(group);
}

function addSourceElement(
  root: THREE.Group,
  item: PublicSiteElement,
  mobile: boolean,
  bulbMaterials: THREE.MeshStandardMaterial[],
) {
  if (AREA_KINDS.has(item.kind)) {
    const visibleHeight = Math.max(0.02, item.height);
    addBox(
      root,
      `Site ${item.kind}`,
      item.width,
      visibleHeight,
      item.depth,
      item.x,
      item.y + visibleHeight / 2 + 0.01,
      item.z,
      item.color,
      {
        rotation: item.rotation,
        roughness: item.kind === "road" || item.kind === "parking" ? 0.95 : 0.88,
      },
    );
    return;
  }

  if (item.kind === "tree") {
    addTree(
      root,
      item.x,
      item.y,
      item.z,
      Math.max(item.height, 1),
      Math.max(Math.min(item.width, item.depth), 0.8),
      mobile,
      item.color,
    );
    return;
  }

  if (item.kind === "plant") {
    addPlant(
      root,
      item.x,
      item.y,
      item.z,
      Math.max(Math.min(item.width, item.depth), 0.35),
      Math.max(item.height, 0.4),
      mobile,
      item.color,
    );
    return;
  }

  if (item.kind === "gate") {
    addGate(root, item, mobile);
    return;
  }

  if (item.kind === "outdoor-light") {
    addLamp(
      root,
      item.x,
      item.y,
      item.z,
      Math.max(item.height, 1.2),
      mobile,
      bulbMaterials,
    );
    return;
  }

  if (STRUCTURAL_KINDS.has(item.kind)) {
    if (item.shape === "cylinder") {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(
          Math.max(item.width / 2, 0.02),
          Math.max(item.depth / 2, 0.02),
          Math.max(item.height, 0.02),
          mobile ? 10 : 18,
        ),
        material(item.color, 0.76, 0.03),
      );
      mesh.name = `Structural ${item.kind}`;
      mesh.position.set(item.x, item.y + item.height / 2, item.z);
      mesh.rotation.y = THREE.MathUtils.degToRad(item.rotation);
      mesh.castShadow = !mobile;
      mesh.receiveShadow = true;
      root.add(mesh);
      return;
    }
    addBox(
      root,
      `Structural ${item.kind}`,
      item.width,
      item.height,
      item.depth,
      item.x,
      item.y + item.height / 2,
      item.z,
      item.color,
      {
        rotation: item.rotation,
        roughness: 0.76,
        metalness: 0.03,
        castShadow: !mobile,
      },
    );
  }
}

function addPresentationFallback(
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
    siteWidth * 1.25,
    0.12,
    roadDepth,
    center.x,
    baseY - 0.035,
    roadZ,
    "#343a40",
    { roughness: 0.98 },
  );

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
    const contextZ = bounds.min.z - margin * 0.92;
    const contextHeight = Math.max(size.y * 0.18, 2.4);
    for (const offset of [-0.36, 0, 0.36]) {
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
        { roughness: 0.97, opacity: 0.52 },
      );
    }
  }
}

function disposeRoot(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    const values = Array.isArray(node.material) ? node.material : [node.material];
    values.forEach((entry) => materials.add(entry));
  });
  geometries.forEach((entry) => entry.dispose());
  materials.forEach((entry) => entry.dispose());
}

export function createArchitecturalSiteEnvironment(
  bounds: THREE.Box3,
  _renderer: THREE.WebGLRenderer,
  mobile: boolean,
) {
  const root = new THREE.Group();
  root.name = "source-backed-site-environment";
  const elements = getPublicRuntimeSiteElements();
  root.userData.sourceBackedSiteElementCount = elements.length;
  const bulbMaterials: THREE.MeshStandardMaterial[] = [];

  if (elements.length) {
    root.userData.presentationOnly = false;
    for (const item of elements) {
      addSourceElement(root, item, mobile, bulbMaterials);
    }
  } else {
    addPresentationFallback(root, bounds, mobile, bulbMaterials);
  }

  return {
    root,
    setNight(night: boolean) {
      for (const bulbMaterial of bulbMaterials) {
        bulbMaterial.emissiveIntensity = night ? 4.2 : 0.32;
      }
    },
    dispose() {
      disposeRoot(root);
      root.clear();
    },
  };
}

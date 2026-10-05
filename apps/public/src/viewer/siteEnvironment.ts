import type { PublicSiteElement } from "@rekixo/3d-contracts";
import * as THREE from "three";
import { addPresentationFallback } from "./presentationEnvironment";
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
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
}

function batchKey(item: PublicSiteElement) {
  return `${item.kind}|${item.color.toLowerCase()}|${item.shape ?? "default"}`;
}

function groupsFor(items: readonly PublicSiteElement[]) {
  const groups = new Map<string, PublicSiteElement[]>();
  for (const item of items) {
    const key = batchKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function matrixFor(
  item: PublicSiteElement,
  y: number,
  scale: THREE.Vector3,
) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(item.x, y, item.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, THREE.MathUtils.degToRad(item.rotation), 0),
    ),
    scale,
  );
  return matrix;
}

function addAreaBatches(root: THREE.Group, items: readonly PublicSiteElement[]) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  for (const rows of groupsFor(items).values()) {
    const first = rows[0];
    const surfaceMaterial = material(
      first.color,
      first.kind === "road" || first.kind === "parking" ? 0.94 : 0.88,
    );
    const mesh = new THREE.InstancedMesh(
      geometry.clone(),
      surfaceMaterial,
      rows.length,
    );
    mesh.name = `Site ${first.kind}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    rows.forEach((item, index) => {
      const visibleHeight = Math.max(0.02, item.height);
      mesh.setMatrixAt(
        index,
        matrixFor(
          item,
          item.y + visibleHeight / 2 + 0.01,
          new THREE.Vector3(item.width, visibleHeight, item.depth),
        ),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
  }
  geometry.dispose();
}

function addTreeBatches(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
) {
  if (!items.length) return;
  const trunkGeometry = new THREE.CylinderGeometry(1, 1, 1, mobile ? 7 : 10);
  const trunkMaterial = material("#715139", 0.92);
  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    trunkMaterial,
    items.length,
  );
  trunks.name = "Site tree trunks";
  trunks.castShadow = !mobile;
  trunks.receiveShadow = true;

  items.forEach((item, index) => {
    const trunkHeight = Math.max(0.65, item.height * 0.48);
    const radius = Math.max(0.04, Math.min(item.width, item.depth) * 0.06);
    trunks.setMatrixAt(
      index,
      matrixFor(
        item,
        item.y + trunkHeight / 2,
        new THREE.Vector3(radius, trunkHeight, radius),
      ),
    );
  });
  trunks.instanceMatrix.needsUpdate = true;
  root.add(trunks);

  const crownGeometry = new THREE.IcosahedronGeometry(1, mobile ? 0 : 1);
  for (const rows of groupsFor(items).values()) {
    const crowns = new THREE.InstancedMesh(
      crownGeometry.clone(),
      material(rows[0].color, 0.96),
      rows.length,
    );
    crowns.name = "Site tree foliage";
    crowns.castShadow = !mobile;
    crowns.receiveShadow = true;
    rows.forEach((item, index) => {
      const radius = Math.max(0.25, Math.min(item.width, item.depth) * 0.42);
      const crownHeight = Math.max(
        radius * 1.2,
        Math.min(item.height * 0.52, radius * 2.6),
      );
      crowns.setMatrixAt(
        index,
        matrixFor(
          item,
          item.y + Math.max(item.height - crownHeight / 2, crownHeight / 2),
          new THREE.Vector3(radius, crownHeight / 2, radius),
        ),
      );
    });
    crowns.instanceMatrix.needsUpdate = true;
    root.add(crowns);
  }
  crownGeometry.dispose();
}

function addPlantBatches(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
) {
  if (!items.length) return;
  const potGeometry = new THREE.CylinderGeometry(1, 0.82, 1, mobile ? 7 : 10);
  const pots = new THREE.InstancedMesh(
    potGeometry,
    material("#815d43", 0.9),
    items.length,
  );
  pots.name = "Site plant pots";
  pots.castShadow = !mobile;
  pots.receiveShadow = true;
  items.forEach((item, index) => {
    const potHeight = Math.max(0.12, Math.min(0.42, item.height * 0.28));
    const radius = Math.max(0.07, Math.min(item.width, item.depth) * 0.2);
    pots.setMatrixAt(
      index,
      matrixFor(
        item,
        item.y + potHeight / 2,
        new THREE.Vector3(radius, potHeight, radius),
      ),
    );
  });
  pots.instanceMatrix.needsUpdate = true;
  root.add(pots);

  const foliageGeometry = new THREE.IcosahedronGeometry(1, mobile ? 0 : 1);
  for (const rows of groupsFor(items).values()) {
    const foliage = new THREE.InstancedMesh(
      foliageGeometry.clone(),
      material(rows[0].color, 0.96),
      rows.length,
    );
    foliage.name = "Site plant foliage";
    foliage.castShadow = !mobile;
    rows.forEach((item, index) => {
      const radius = Math.max(0.12, Math.min(item.width, item.depth) * 0.38);
      const height = Math.max(radius * 1.2, item.height * 0.68);
      foliage.setMatrixAt(
        index,
        matrixFor(
          item,
          item.y + Math.max(height / 2, item.height * 0.58),
          new THREE.Vector3(radius, height / 2, radius),
        ),
      );
    });
    foliage.instanceMatrix.needsUpdate = true;
    root.add(foliage);
  }
  foliageGeometry.dispose();
}

function addGate(root: THREE.Group, item: PublicSiteElement, mobile: boolean) {
  const group = new THREE.Group();
  group.name = "Site gate";
  group.position.set(item.x, item.y, item.z);
  group.rotation.y = THREE.MathUtils.degToRad(item.rotation);
  const gateMaterial = material(item.color, 0.55, 0.22);
  const postWidth = Math.max(0.08, Math.min(0.2, item.width * 0.06));
  const depth = Math.max(0.08, item.depth);
  const add = (
    width: number,
    height: number,
    x: number,
    y: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      gateMaterial,
    );
    mesh.position.set(x, y, 0);
    mesh.castShadow = !mobile;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(postWidth, item.height, -item.width / 2 + postWidth / 2, item.height / 2);
  add(postWidth, item.height, item.width / 2 - postWidth / 2, item.height / 2);
  add(
    Math.max(postWidth, item.width - postWidth * 2),
    Math.max(0.06, item.height * 0.07),
    0,
    item.height * 0.82,
  );
  root.add(group);
}

function addOutdoorLights(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
) {
  if (!items.length) return undefined;
  const poleGeometry = new THREE.CylinderGeometry(1, 1, 1, mobile ? 7 : 10);
  const poles = new THREE.InstancedMesh(
    poleGeometry,
    material("#4f5357", 0.58, 0.28),
    items.length,
  );
  poles.name = "Site outdoor light poles";
  poles.castShadow = !mobile;
  items.forEach((item, index) => {
    const radius = Math.max(0.035, Math.min(item.width, item.depth) * 0.22);
    const height = Math.max(0.3, item.height * 0.92);
    poles.setMatrixAt(
      index,
      matrixFor(
        item,
        item.y + height / 2,
        new THREE.Vector3(radius, height, radius),
      ),
    );
  });
  poles.instanceMatrix.needsUpdate = true;
  root.add(poles);

  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: "#fff2ce",
    emissive: "#ffd188",
    emissiveIntensity: 0.38,
    roughness: 0.28,
  });
  const bulbGeometry = new THREE.SphereGeometry(1, mobile ? 7 : 10, mobile ? 5 : 7);
  const bulbs = new THREE.InstancedMesh(
    bulbGeometry,
    bulbMaterial,
    items.length,
  );
  bulbs.name = "Site outdoor light bulbs";
  items.forEach((item, index) => {
    const radius = Math.max(0.07, Math.min(item.width, item.depth) * 0.42);
    bulbs.setMatrixAt(
      index,
      matrixFor(
        item,
        item.y + item.height,
        new THREE.Vector3(radius, radius, radius),
      ),
    );
  });
  bulbs.instanceMatrix.needsUpdate = true;
  root.add(bulbs);
  return bulbMaterial;
}

function addStructuralBatches(
  root: THREE.Group,
  items: readonly PublicSiteElement[],
  mobile: boolean,
) {
  for (const rows of groupsFor(items).values()) {
    const first = rows[0];
    const cylinder = first.shape === "cylinder";
    const geometry = cylinder
      ? new THREE.CylinderGeometry(1, 1, 1, mobile ? 10 : 18)
      : new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(
      geometry,
      material(first.color, 0.76, 0.03),
      rows.length,
    );
    mesh.name = `Structural ${first.kind}`;
    mesh.castShadow = !mobile;
    mesh.receiveShadow = true;
    rows.forEach((item, index) => {
      mesh.setMatrixAt(
        index,
        matrixFor(
          item,
          item.y + item.height / 2,
          cylinder
            ? new THREE.Vector3(item.width / 2, item.height, item.depth / 2)
            : new THREE.Vector3(item.width, item.height, item.depth),
        ),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
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
  presentation = false,
  groundElevation?: number,
) {
  const root = new THREE.Group();
  root.name = "source-backed-site-environment";
  const elements = getPublicRuntimeSiteElements();
  root.userData.sourceBackedSiteElementCount = elements.length;

  const areas = elements.filter((item) => AREA_KINDS.has(item.kind));
  const trees = elements.filter((item) => item.kind === "tree");
  const plants = elements.filter((item) => item.kind === "plant");
  const gates = elements.filter((item) => item.kind === "gate");
  const lights = elements.filter((item) => item.kind === "outdoor-light");
  const structural = elements.filter((item) => STRUCTURAL_KINDS.has(item.kind));

  const presentationBulbs: THREE.MeshStandardMaterial[] = [];
  // Basement bounds are not a ground survey. Omit optional dressing if grade is unknown.
  const knownGrade = typeof groundElevation === "number" && Number.isFinite(groundElevation);
  if (!elements.length && presentation && !bounds.isEmpty() && (knownGrade || bounds.min.y >= -0.25)) {
    addPresentationFallback(root, bounds, mobile, presentationBulbs, knownGrade ? groundElevation : bounds.min.y);
  }

  addAreaBatches(root, areas);
  addTreeBatches(root, trees, mobile);
  addPlantBatches(root, plants, mobile);
  gates.forEach((item) => addGate(root, item, mobile));
  const bulbMaterial = addOutdoorLights(root, lights, mobile);
  addStructuralBatches(root, structural, mobile);

  return {
    root,
    setNight(night: boolean) {
      if (bulbMaterial) bulbMaterial.emissiveIntensity = night ? 4.2 : 0.38;
      for (const bulb of presentationBulbs) bulb.emissiveIntensity = night ? 4.2 : 0.38;
    },
    dispose() {
      disposeRoot(root);
      root.clear();
    },
  };
}

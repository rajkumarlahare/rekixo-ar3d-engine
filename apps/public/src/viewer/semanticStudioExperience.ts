import * as THREE from "three";
import type { ExperienceRuntime } from "./projectProfiles";
import type { ExperienceMode } from "./experienceTypes";
import {
  getSemanticInteriorRuntime,
  type SemanticRoom,
} from "./semanticInteriorRuntime";
import { buildAllReviewedWallPieces } from "./wallOpeningPieces";

function roomShape(room: SemanticRoom) {
  const shape = new THREE.Shape();
  room.boundary.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  shape.closePath();
  return shape;
}

function roomBounds(room: SemanticRoom) {
  const box = new THREE.Box3();
  for (const [x, z] of room.boundary) {
    box.expandByPoint(new THREE.Vector3(x, room.elevation, z));
    box.expandByPoint(
      new THREE.Vector3(x, room.elevation + room.height, z),
    );
  }
  return box;
}

function roomCenter(room: SemanticRoom) {
  const x =
    room.boundary.reduce((sum, point) => sum + point[0], 0) /
    room.boundary.length;
  const z =
    room.boundary.reduce((sum, point) => sum + point[1], 0) /
    room.boundary.length;
  return new THREE.Vector3(
    x,
    room.elevation + Math.min(1.6, Math.max(1.2, room.height * 0.55)),
    z,
  );
}

function disposeRoot(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const list = Array.isArray(object.material)
      ? object.material
      : [object.material];
    list.forEach((entry) => materials.add(entry));
  });
  geometries.forEach((entry) => entry.dispose());
  materials.forEach((entry) => entry.dispose());
}

export function createSemanticStudioExperience(
  fallbackBounds: THREE.Box3,
  mobile: boolean,
): ExperienceRuntime | undefined {
  const runtime = getSemanticInteriorRuntime();
  if (!runtime?.walls.length) return undefined;

  const root = new THREE.Group();
  root.name = "Reviewed semantic interior";
  root.visible = false;
  let currentMode: ExperienceMode = "site";
  let walk = false;

  const pieces = buildAllReviewedWallPieces(
    runtime.walls,
    runtime.openings,
  );
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: "#eee9e1",
    roughness: 0.9,
    metalness: 0,
  });
  if (pieces.length) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const walls = new THREE.InstancedMesh(
      geometry,
      wallMaterial,
      pieces.length,
    );
    walls.name = "Reviewed walls with opening cuts";
    walls.castShadow = !mobile;
    walls.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    pieces.forEach((piece, index) => {
      position.set(...piece.center);
      rotation.setFromEuler(
        new THREE.Euler(
          0,
          THREE.MathUtils.degToRad(piece.rotationY),
          0,
        ),
      );
      scale.set(piece.length, piece.height, piece.thickness);
      matrix.compose(position, rotation, scale);
      walls.setMatrixAt(index, matrix);
    });
    walls.instanceMatrix.needsUpdate = true;
    root.add(walls);
  }

  const floorGroup = new THREE.Group();
  floorGroup.name = "Reviewed room floors";
  root.add(floorGroup);
  const rooms = runtime.rooms.map((room) => {
    const material = new THREE.MeshStandardMaterial({
      color: room.color,
      roughness: 0.94,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: room.verified ? 0.72 : 0.32,
      depthWrite: room.verified,
    });
    const floor = new THREE.Mesh(
      new THREE.ShapeGeometry(roomShape(room)),
      material,
    );
    floor.name = `${room.unit} · ${room.name}`;
    floor.rotation.x = Math.PI / 2;
    floor.position.y = room.elevation + 0.012;
    floor.receiveShadow = true;
    floor.userData.experienceFeatureId = room.id;
    floorGroup.add(floor);
    return {
      id: room.id,
      label: room.name,
      category: room.unit,
      description: room.verified
        ? "Human-reviewed room geometry from the published Studio release."
        : "Reconstructed room context; wall/opening geometry shown here is limited to reviewed semantic elements.",
      object: floor,
    };
  });

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: "#93bed0",
    roughness: 0.2,
    metalness: 0,
    transparent: true,
    opacity: 0.34,
    transmission: mobile ? 0 : 0.45,
    depthWrite: false,
  });
  for (const opening of runtime.openings) {
    if (opening.kind !== "window") continue;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(0.04, opening.width * 0.96),
        Math.max(0.04, opening.height * 0.96),
        0.025,
      ),
      glassMaterial,
    );
    glass.name = "Reviewed window glass";
    glass.position.set(opening.x, opening.y, opening.z);
    glass.rotation.y = THREE.MathUtils.degToRad(opening.rotationY);
    glass.renderOrder = 5;
    root.add(glass);
  }

  const semanticBounds = new THREE.Box3().setFromObject(root);
  const focusBounds = semanticBounds.isEmpty()
    ? fallbackBounds.clone()
    : semanticBounds;

  const updateVisibility = () => {
    root.visible = currentMode === "interior" || walk;
  };

  return {
    root,
    rooms,
    features: rooms,
    roomEntry(id) {
      const room = runtime.rooms.find((candidate) => candidate.id === id);
      if (!room) return undefined;
      return {
        point: roomCenter(room),
        bounds: roomBounds(room),
        scale: 1,
      };
    },
    setWalk(enabled) {
      walk = enabled;
      updateVisibility();
    },
    setMode(mode) {
      currentMode = mode;
      updateVisibility();
    },
    setNight(night) {
      wallMaterial.color.set(night ? "#a7a199" : "#eee9e1");
      glassMaterial.emissive.set(night ? "#23394a" : "#000000");
      glassMaterial.emissiveIntensity = night ? 0.18 : 0;
    },
    focus(mode) {
      const box = focusBounds.clone();
      const target = box.getCenter(new THREE.Vector3());
      if (mode === "interior")
        target.y = box.min.y + box.getSize(new THREE.Vector3()).y * 0.38;
      return { box, target };
    },
    dispose() {
      disposeRoot(root);
      root.clear();
    },
  };
}

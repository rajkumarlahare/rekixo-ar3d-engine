import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraPreset3D } from "@rekixo/3d-contracts";

export interface HomeView {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const DEFAULT_FOV = 42;
const MIN_PRESENTATION_FOV = 20;
const MAX_PRESENTATION_FOV = 75;
const DEFAULT_CAMERA_OFFSET = new THREE.Vector3(8, 6, 9);

function finiteTuple(value: readonly number[]) {
  return value.length === 3 && value.every((item) => Number.isFinite(item));
}

function finiteVector(value: THREE.Vector3) {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

/**
 * Launch Phase 1 camera gate.
 *
 * Published project presets are data, so keep them authoritative when valid,
 * but never allow NaN/Infinity, a zero-length look vector or an extreme FOV to
 * make the approved source model disappear from the customer viewer.
 */
export function normalizeCameraPreset(preset: CameraPreset3D): HomeView {
  const target = finiteTuple(preset.target)
    ? new THREE.Vector3(...preset.target)
    : new THREE.Vector3();
  const position = finiteTuple(preset.position)
    ? new THREE.Vector3(...preset.position)
    : target.clone().add(DEFAULT_CAMERA_OFFSET);

  if (position.distanceToSquared(target) < 0.01) {
    position.copy(target).add(DEFAULT_CAMERA_OFFSET);
  }

  const requestedFov = preset.fov ?? DEFAULT_FOV;
  const fov = Number.isFinite(requestedFov)
    ? THREE.MathUtils.clamp(
        requestedFov,
        MIN_PRESENTATION_FOV,
        MAX_PRESENTATION_FOV,
      )
    : DEFAULT_FOV;

  return { position, target, fov };
}

/**
 * Keep the depth buffer focused on the active architectural view. Authored
 * camera shots bypass fitCamera(), and zooming otherwise keeps a stale far
 * plane (often 2000m) that makes near-coplanar faces fight for the same depth.
 */
export function updateCameraDepthRange(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  bounds: THREE.Box3,
) {
  if (bounds.isEmpty()) return false;

  const width = Math.max(bounds.max.x - bounds.min.x, 0);
  const height = Math.max(bounds.max.y - bounds.min.y, 0);
  const depth = Math.max(bounds.max.z - bounds.min.z, 0);
  const modelScale = Math.max(width, height, depth, 0.1);
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerY = (bounds.min.y + bounds.max.y) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  const radius = Math.max(Math.hypot(width, height, depth) * 0.5, modelScale * 0.5);
  const centerDistance = Math.hypot(
    camera.position.x - centerX,
    camera.position.y - centerY,
    camera.position.z - centerZ,
  );
  const targetDistance = Math.max(camera.position.distanceTo(target), 0.01);

  // Choose the largest safe near plane for the current zoom while keeping a
  // small scale-relative floor for detailed architectural geometry.
  const nearFloor = Math.max(0.0005, modelScale * 0.00002);
  const near = Math.max(
    nearFloor,
    Math.min(targetDistance * 0.01, modelScale * 0.004),
  );
  // The generated exterior ground extends beyond the source bounds. Keep a
  // scale-based horizon margin but avoid the fixed 0.01..2000 range on houses.
  // The generated fallback uses an 8-unit minimum site span even for
  // small source models, so keep its distant ground inside the clip volume.
  const sceneScale = Math.max(modelScale, 8);
  const far = Math.max(
    centerDistance + radius * 1.25 + modelScale * 0.1,
    sceneScale * 18,
    near * 1000,
  );

  if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) return false;
  if (
    Math.abs(camera.near - near) > 0.00001 ||
    Math.abs(camera.far - far) > 0.001
  ) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    return true;
  }
  return false;
}

export function fitCamera(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): HomeView {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const validSphere =
    !box.isEmpty() && finiteVector(sphere.center) && Number.isFinite(sphere.radius);
  const center = validSphere ? sphere.center : new THREE.Vector3();
  const radius = validSphere ? Math.max(sphere.radius, 1) : 1;
  const requestedFov = Number.isFinite(camera.fov) ? camera.fov : DEFAULT_FOV;
  camera.fov = THREE.MathUtils.clamp(
    requestedFov,
    MIN_PRESENTATION_FOV,
    MAX_PRESENTATION_FOV,
  );
  const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const distance = Math.max(radius / Math.sin(halfFov), radius * 2.1);
  const direction = new THREE.Vector3(1, 0.72, 1).normalize();

  camera.position.copy(
    center.clone().add(direction.multiplyScalar(distance * 0.72)),
  );
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = Math.max(distance * 30, 250);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(radius * 0.55, 1.5);
  controls.maxDistance = Math.max(radius * 8, 40);
  controls.update();

  return {
    position: camera.position.clone(),
    target: controls.target.clone(),
    fov: camera.fov,
  };
}

export function applyPreset(
  preset: CameraPreset3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): HomeView {
  const { position, target, fov } = normalizeCameraPreset(preset);

  camera.position.copy(position);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.update();

  return { position, target, fov };
}

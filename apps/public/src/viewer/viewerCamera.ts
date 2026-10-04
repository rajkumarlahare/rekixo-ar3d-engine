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
const MAX_ARCHITECTURAL_ELEVATION_RATIO = 0.52;

function finiteTuple(value: readonly number[]) {
  return value.length === 3 && value.every((item) => Number.isFinite(item));
}

function finiteVector(value: THREE.Vector3) {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function reduceTopDownLaunchAngle(position: THREE.Vector3, target: THREE.Vector3) {
  const delta = position.clone().sub(target);
  const horizontalDistance = Math.hypot(delta.x, delta.z);
  if (!Number.isFinite(horizontalDistance) || horizontalDistance < 0.5) return;
  const maxVertical = horizontalDistance * MAX_ARCHITECTURAL_ELEVATION_RATIO;
  if (delta.y > maxVertical) position.y = target.y + maxVertical;
}

/**
 * Launch camera safety + composition gate.
 *
 * Published project presets remain authoritative for target, azimuth and distance,
 * but the first customer-facing frame avoids an extreme top-down angle. This only
 * changes camera composition; it never changes model geometry or project facts.
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
  reduceTopDownLaunchAngle(position, target);

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
  const direction = new THREE.Vector3(1, 0.46, 1).normalize();

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

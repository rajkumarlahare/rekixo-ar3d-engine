import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraPreset3D } from "@rekixo/3d-contracts";

export interface HomeView {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export function fitCamera(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): HomeView {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1);
  const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const distance = Math.max(radius / Math.sin(halfFov), radius * 2.1);
  const direction = new THREE.Vector3(1, 0.72, 1).normalize();

  camera.position.copy(
    sphere.center.clone().add(direction.multiplyScalar(distance * 0.72)),
  );
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = Math.max(distance * 30, 250);
  camera.updateProjectionMatrix();

  controls.target.copy(sphere.center);
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
  const position = new THREE.Vector3(...preset.position);
  const target = new THREE.Vector3(...preset.target);
  const fov = preset.fov ?? 45;

  camera.position.copy(position);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.update();

  return { position, target, fov };
}

import * as THREE from "three";
import type { HomeView } from "./viewerCamera";

export type ExteriorView = "hero" | "front" | "corner" | "entrance" | "aerial";

/** Fit every measured corner in both viewport axes; retain authored front direction. */
export function exteriorCameraView(
  bounds: THREE.Box3,
  home: HomeView,
  aspect: number,
  view: ExteriorView,
  heroDirection?: readonly [number, number, number],
): HomeView {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const direction = heroDirection ? new THREE.Vector3(...heroDirection) : home.position.clone().sub(home.target);
  direction.y = 0;
  if (direction.lengthSq() < 0.01) direction.set(1, 0, 1);
  direction.normalize();
  if (view === "front" || view === "entrance") {
    // The saved hero azimuth is the source of orientation; no project-name guesses.
    const angle = Math.atan2(direction.x, direction.z);
    const frontAngle = Math.round(angle / (Math.PI / 2)) * Math.PI / 2;
    direction.set(Math.sin(frontAngle), 0, Math.cos(frontAngle));
  } else if (view === "corner") {
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 10);
  }
  const target = center.clone();
  target.y = bounds.min.y + size.y * (view === "entrance" ? 0.22 : 0.46);
  direction.y = view === "aerial" ? 0.85 : view === "entrance" ? -0.08 : -0.025;
  direction.normalize();
  const fov = view === "entrance" ? 46 : 42;
  const verticalHalf = THREE.MathUtils.degToRad(fov / 2);
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * Math.max(aspect, 0.1));
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  let distance = 1;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(target);
        distance = Math.max(distance, offset.dot(direction) + Math.abs(offset.dot(right)) / Math.tan(horizontalHalf), offset.dot(direction) + Math.abs(offset.dot(up)) / Math.tan(verticalHalf));
      }
    }
  }
  // Entrance is a deliberate close-up, the other views keep the complete building visible.
  distance *= view === "entrance" ? 0.65 : 1.18;
  return { position: target.clone().addScaledVector(direction, distance), target, fov };
}

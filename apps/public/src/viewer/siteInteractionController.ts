import * as THREE from "three";

interface GateLeafTarget {
  pivot: THREE.Group;
  closedAngle: number;
  openAngle: number;
  progress: number;
  target: number;
  originalAngle: number;
}

export interface SiteInteractionController {
  readonly gateCount: number;
  update(deltaSeconds: number): void;
  dispose(): void;
}

/**
 * Click-to-open interaction for presentation-owned site gates.
 * Only explicitly tagged generated gate-leaf pivots are eligible; source
 * Building meshes are never rotated by this controller.
 */
export function createSiteInteractionController(
  root: THREE.Object3D,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  reducedMotion: boolean,
): SiteInteractionController {
  const targets: GateLeafTarget[] = [];
  root.traverse((node) => {
    if (
      !(node instanceof THREE.Group) ||
      node.userData.siteInteraction?.kind !== "gate-leaf"
    )
      return;
    const closedAngle = Number(node.userData.siteInteraction.closedAngle);
    const openAngle = Number(node.userData.siteInteraction.openAngle);
    if (!Number.isFinite(closedAngle) || !Number.isFinite(openAngle)) return;
    targets.push({
      pivot: node,
      closedAngle,
      openAngle,
      progress: 0,
      target: 0,
      originalAngle: node.rotation.y,
    });
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let disposed = false;

  const handleClick = (event: MouseEvent) => {
    if (disposed || event.button !== 0 || !targets.length) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(root, true).find((intersection) => {
      let node: THREE.Object3D | null = intersection.object;
      while (node && node !== root) {
        if (node.userData.siteInteraction?.kind === "gate-leaf") return true;
        node = node.parent;
      }
      return false;
    });
    if (!hit) return;

    let node: THREE.Object3D | null = hit.object;
    while (node && node !== root) {
      const target = targets.find((entry) => entry.pivot === node);
      if (target) {
        target.target = target.target === 1 ? 0 : 1;
        if (reducedMotion) {
          target.progress = target.target;
          target.pivot.rotation.y =
            target.closedAngle +
            (target.openAngle - target.closedAngle) * target.progress;
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      node = node.parent;
    }
  };

  canvas.addEventListener("click", handleClick);

  return {
    gateCount: targets.length,
    update(deltaSeconds: number) {
      if (disposed || reducedMotion || !Number.isFinite(deltaSeconds)) return;
      const delta = Math.min(Math.max(deltaSeconds, 0), 0.05);
      const blend = 1 - Math.exp(-delta * 5.5);
      for (const target of targets) {
        target.progress = THREE.MathUtils.lerp(
          target.progress,
          target.target,
          blend,
        );
        if (Math.abs(target.target - target.progress) < 0.001)
          target.progress = target.target;
        target.pivot.rotation.y =
          target.closedAngle +
          (target.openAngle - target.closedAngle) * target.progress;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("click", handleClick);
      for (const target of targets) {
        target.pivot.rotation.y = target.originalAngle;
        target.pivot.userData.siteInteraction = undefined;
      }
      targets.length = 0;
    },
  };
}

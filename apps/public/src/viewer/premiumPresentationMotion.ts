import * as THREE from "three";

type PremiumMotionTargetKind = "tree" | "plant";

interface PremiumMotionTarget {
  object: THREE.Object3D;
  kind: PremiumMotionTargetKind;
  baseRotationX: number;
  baseRotationZ: number;
  phase: number;
  amplitude: number;
  speed: number;
}

export interface PremiumPresentationMotion {
  readonly enabled: boolean;
  update(deltaSeconds: number): void;
  dispose(): void;
}

const GOLDEN_PHASE = 1.618033988749895;
const MAX_FRAME_DELTA_SECONDS = 0.05;

function noMotion(): PremiumPresentationMotion {
  return {
    enabled: false,
    update() {},
    dispose() {},
  };
}

function presentationTargetKind(object: THREE.Object3D): PremiumMotionTargetKind | undefined {
  if (object.name === "Site tree") return "tree";
  if (object.name === "Site plant") return "plant";
  return undefined;
}

/**
 * Adds restrained ambient motion only to Rekixo-generated presentation dressing.
 *
 * Safety boundary:
 * - the root must be explicitly marked `presentationOnly`;
 * - source Building geometry is never accepted as a target;
 * - only generated Site tree / Site plant groups move;
 * - transforms are restored on dispose;
 * - reduced-motion users receive a deterministic no-op controller.
 *
 * The controller allocates its target table once. `update` performs only scalar
 * math and transform writes so it can share the viewer render loop without
 * per-frame object allocation.
 */
export function createPremiumPresentationMotion(
  environmentRoot: THREE.Object3D | undefined,
  options: { reducedMotion: boolean; mobile: boolean },
): PremiumPresentationMotion {
  if (
    !environmentRoot ||
    options.reducedMotion ||
    environmentRoot.userData.presentationOnly !== true
  )
    return noMotion();

  const targets: PremiumMotionTarget[] = [];
  environmentRoot.traverse((object) => {
    const kind = presentationTargetKind(object);
    if (!kind) return;

    const index = targets.length;
    const mobileFactor = options.mobile ? 0.65 : 1;
    targets.push({
      object,
      kind,
      baseRotationX: object.rotation.x,
      baseRotationZ: object.rotation.z,
      phase:
        index * GOLDEN_PHASE +
        object.position.x * 0.037 +
        object.position.z * 0.021,
      amplitude: (kind === "tree" ? 0.012 : 0.02) * mobileFactor,
      speed: kind === "tree" ? 0.68 : 0.9,
    });
  });

  if (!targets.length) return noMotion();

  let elapsed = 0;
  let disposed = false;

  return {
    enabled: true,
    update(deltaSeconds: number) {
      if (disposed || !Number.isFinite(deltaSeconds)) return;
      elapsed += Math.min(
        Math.max(deltaSeconds, 0),
        MAX_FRAME_DELTA_SECONDS,
      );

      for (const target of targets) {
        const primary =
          Math.sin(elapsed * target.speed + target.phase) * target.amplitude;
        const secondary =
          Math.sin(
            elapsed * target.speed * 0.47 + target.phase * 1.7,
          ) *
          target.amplitude *
          0.32;
        target.object.rotation.z = target.baseRotationZ + primary;
        target.object.rotation.x = target.baseRotationX + secondary;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const target of targets) {
        target.object.rotation.x = target.baseRotationX;
        target.object.rotation.z = target.baseRotationZ;
      }
      targets.length = 0;
    },
  };
}

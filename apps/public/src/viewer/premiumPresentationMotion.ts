import * as THREE from "three";

type WindTargetKind = "tree" | "plant";
type WindUniform = { value: number };
type WindShaderUniforms = {
  uRekixoWindTime?: WindUniform;
  uRekixoWindStrength?: WindUniform;
};

interface WindTarget {
  material: THREE.MeshStandardMaterial;
  kind: WindTargetKind;
  strength: number;
  uniforms?: WindShaderUniforms;
  originalOnBeforeCompile: THREE.Material["onBeforeCompile"];
  originalProgramCacheKey: THREE.Material["customProgramCacheKey"];
}

export interface PremiumPresentationMotion {
  readonly enabled: boolean;
  update(deltaSeconds: number): void;
  dispose(): void;
}

const MAX_FRAME_DELTA_SECONDS = 0.05;

function noMotion(): PremiumPresentationMotion {
  return {
    enabled: false,
    update() {},
    dispose() {},
  };
}

function foliageKind(object: THREE.Object3D): WindTargetKind | undefined {
  if (object.name === "Site tree foliage") return "tree";
  if (object.name === "Site plant foliage") return "plant";
  return undefined;
}

function materialsOf(object: THREE.Object3D): THREE.MeshStandardMaterial[] {
  if (!(object instanceof THREE.Mesh)) return [];
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.filter(
    (entry): entry is THREE.MeshStandardMaterial =>
      entry instanceof THREE.MeshStandardMaterial,
  );
}

/**
 * Adds subtle wind deformation to generated foliage only.
 *
 * The wind runs in foliage vertex shaders rather than rotating whole tree
 * groups: trunks, pots, foundations, and reviewed/source Building geometry stay
 * still. Instance position provides each tree/plant a distinct wind phase.
 * The controller only attaches to roots explicitly marked presentationOnly.
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

  const targetByMaterial = new Map<THREE.MeshStandardMaterial, WindTarget>();
  environmentRoot.traverse((object) => {
    const kind = foliageKind(object);
    if (!kind) return;
    for (const windMaterial of materialsOf(object)) {
      if (targetByMaterial.has(windMaterial) || windMaterial.userData.rekixoWindEnabled === true)
        continue;
      targetByMaterial.set(windMaterial, {
        material: windMaterial,
        kind,
        strength: (kind === "tree" ? 0.095 : 0.055) * (options.mobile ? 0.72 : 1),
        originalOnBeforeCompile: windMaterial.onBeforeCompile,
        originalProgramCacheKey: windMaterial.customProgramCacheKey,
      });
    }
  });

  const targets = [...targetByMaterial.values()];
  if (!targets.length) return noMotion();

  let elapsed = 0;
  let disposed = false;
  for (const target of targets) {
    const windMaterial = target.material;
    const originalOnBeforeCompile = target.originalOnBeforeCompile;
    const originalProgramCacheKey = target.originalProgramCacheKey;
    windMaterial.userData.rekixoWindEnabled = true;
    windMaterial.onBeforeCompile = (shader, renderer) => {
      originalOnBeforeCompile.call(windMaterial, shader, renderer);
      shader.uniforms.uRekixoWindTime = { value: elapsed };
      shader.uniforms.uRekixoWindStrength = { value: target.strength };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nuniform float uRekixoWindTime;\nuniform float uRekixoWindStrength;",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float rekixoWindPhase = instanceMatrix[3].x * 0.173 + instanceMatrix[3].z * 0.137;
        #else
          float rekixoWindPhase = 0.0;
        #endif
        float rekixoWindHeight = max(position.y, 0.0);
        float rekixoWindWave = sin(uRekixoWindTime * 0.72 + rekixoWindPhase + position.z * 1.7 + position.x * 0.8);
        transformed.x += rekixoWindWave * rekixoWindHeight * uRekixoWindStrength;
        transformed.z += cos(uRekixoWindTime * 0.51 + rekixoWindPhase * 1.3 + position.x) *
          rekixoWindHeight * uRekixoWindStrength * 0.38;`,
      );
      target.uniforms = shader.uniforms as WindShaderUniforms;
    };
    windMaterial.customProgramCacheKey = () =>
      `${originalProgramCacheKey.call(windMaterial)}|rekixo-foliage-wind-v1-${target.kind}`;
    windMaterial.needsUpdate = true;
  }

  return {
    enabled: true,
    update(deltaSeconds: number) {
      if (disposed || !Number.isFinite(deltaSeconds)) return;
      elapsed += Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_DELTA_SECONDS);
      for (const target of targets) {
        if (target.uniforms?.uRekixoWindTime) {
          target.uniforms.uRekixoWindTime.value = elapsed;
        }
        if (target.uniforms?.uRekixoWindStrength) {
          target.uniforms.uRekixoWindStrength.value = target.strength;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const target of targets) {
        target.material.onBeforeCompile = target.originalOnBeforeCompile;
        target.material.customProgramCacheKey = target.originalProgramCacheKey;
        delete target.material.userData.rekixoWindEnabled;
        target.material.needsUpdate = true;
      }
      targets.length = 0;
    },
  };
}

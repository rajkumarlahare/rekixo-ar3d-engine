import * as T from "three";
import type { ModelProfileRuntime } from "@rekixo/3d-model-profiles";
import type { SceneAppearance } from "./domain";

export interface SceneCanvasAppearanceRuntime {
  scene: T.Scene;
  renderer: T.WebGLRenderer;
  hemi: T.HemisphereLight;
  sun: T.DirectionalLight;
  fill: T.DirectionalLight;
  grid: T.Object3D;
  profileExterior?: ModelProfileRuntime["exterior"];
}

export function applySceneCanvasAppearance(
  runtime: SceneCanvasAppearanceRuntime,
  appearance: SceneAppearance | undefined,
  focusedInterior: boolean,
) {
  runtime.renderer.toneMappingExposure = focusedInterior
    ? Math.max(appearance?.exposure ?? 1, 1.08)
    : appearance?.exposure ?? 1;
  runtime.hemi.intensity = focusedInterior
    ? Math.max(appearance?.hemisphereIntensity ?? 2.8, 3.15)
    : appearance?.hemisphereIntensity ?? 2.8;
  runtime.sun.intensity = focusedInterior
    ? Math.max(appearance?.sunIntensity ?? 3.2, 3.45)
    : appearance?.sunIntensity ?? 3.2;
  runtime.fill.intensity = focusedInterior ? 1 : 0.72;
  runtime.grid.visible = !focusedInterior;

  if (focusedInterior) {
    runtime.scene.background = new T.Color("#e7e1d8");
    return;
  }
  if (runtime.profileExterior) {
    const night = appearance?.nightMode ?? false;
    runtime.profileExterior.setNight(night);
    runtime.scene.background = night
      ? runtime.profileExterior.eveningSky
      : runtime.profileExterior.daylightSky;
    return;
  }
  runtime.scene.background = new T.Color(appearance?.background ?? "#dbe3e7");
}

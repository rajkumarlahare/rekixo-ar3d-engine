import * as T from "three";
import { analyzeReferencePixels, type ReferencePixelAnalysis } from "./referenceImagePalette";

export interface SceneCanvasVisualSampleRuntime {
  scene: T.Scene;
  camera: T.Camera;
  renderer: T.WebGLRenderer;
  model: T.Group;
  grid: T.Object3D;
  references: T.Object3D;
  transformHelper: T.Object3D;
  roomDraft: T.Object3D;
  wallDraft: T.Object3D;
  polygonDraft: T.Object3D;
  polygonEdit: T.Object3D;
  multiSelection: T.Object3D;
  modelSelection?: T.Object3D;
}

/**
 * Capture only the rendered building appearance. Editor helpers/reference planes
 * are hidden so the score cannot be improved by UI overlays. This remains a
 * presentation comparison only; it is not geometric/source-fidelity evidence.
 */
export function captureSceneVisualSample(
  runtime: SceneCanvasVisualSampleRuntime,
): ReferencePixelAnalysis {
  if (!runtime.model.children.length)
    throw Error("Load the building model before scoring the current view.");

  const visibility: Array<[T.Object3D, boolean]> = [
    [runtime.grid, runtime.grid.visible],
    [runtime.references, runtime.references.visible],
    [runtime.transformHelper, runtime.transformHelper.visible],
    [runtime.roomDraft, runtime.roomDraft.visible],
    [runtime.wallDraft, runtime.wallDraft.visible],
    [runtime.polygonDraft, runtime.polygonDraft.visible],
    [runtime.polygonEdit, runtime.polygonEdit.visible],
    [runtime.multiSelection, runtime.multiSelection.visible],
  ];
  if (runtime.modelSelection)
    visibility.push([runtime.modelSelection, runtime.modelSelection.visible]);

  try {
    for (const [object] of visibility) object.visible = false;
    runtime.renderer.render(runtime.scene, runtime.camera);
    const sourceCanvas = runtime.renderer.domElement;
    const maxEdge = 640;
    const scale = Math.min(
      1,
      maxEdge / Math.max(sourceCanvas.width, sourceCanvas.height),
    );
    const width = Math.max(2, Math.round(sourceCanvas.width * scale));
    const height = Math.max(2, Math.round(sourceCanvas.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("Rendered-view comparison canvas is unavailable.");
    context.drawImage(sourceCanvas, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    return analyzeReferencePixels(pixels.data, width, height);
  } finally {
    for (const [object, visible] of visibility) object.visible = visible;
    runtime.renderer.render(runtime.scene, runtime.camera);
  }
}

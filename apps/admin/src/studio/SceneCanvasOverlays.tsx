import type { PointerEvent as ReactPointerEvent } from "react";
import CanvasAuthoringHints from "./CanvasAuthoringHints";

interface SceneCanvasOverlaysProps {
  status: string;
  alignmentMode?: boolean;
  view: "building" | "rooms" | "walk";
  furnitureActive: boolean;
  stampActive: boolean;
  roomActive: boolean;
  polygonActive: boolean;
  onReset: () => void;
  onWalkKey: (key: string, active: boolean) => void;
}

export default function SceneCanvasOverlays({
  status,
  alignmentMode,
  view,
  furnitureActive,
  stampActive,
  roomActive,
  polygonActive,
  onReset,
  onWalkKey,
}: SceneCanvasOverlaysProps) {
  const press = (key: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    onWalkKey(key, true);
  };

  return (
    <>
      {status && (
        <div className="canvas-status" role="status">
          {status}
        </div>
      )}
      <CanvasAuthoringHints
        furniture={furnitureActive}
        stamp={stampActive}
        room={roomActive}
        polygon={polygonActive}
      />
      {alignmentMode && (
        <div className="alignment-canvas-legend" aria-label="Alignment canvas legend">
          <span className="model-key">3D MODEL</span>
          <span className="plan-key">BLUE FADED = REFERENCE PLAN</span>
          <small>Move only on the flat X/Z plane · camera rotation is locked</small>
        </div>
      )}
      <button className="reset-camera" onClick={onReset}>
        Reset view
      </button>
      {view === "walk" && (
        <div className="walk-pad">
          <span>
            Drag to look · WASD inside room · reviewed shared doors connect rooms · use room navigation when door evidence is unavailable
          </span>
          {[
            ["w", "↑"],
            ["a", "←"],
            ["s", "↓"],
            ["d", "→"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-label={`Walk ${label}`}
              onPointerDown={(event) => press(key, event)}
              onPointerUp={() => onWalkKey(key, false)}
              onPointerCancel={() => onWalkKey(key, false)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

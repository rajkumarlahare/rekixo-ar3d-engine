import type { Floor, Opening, Wall } from "./domain";
import { wallLength } from "./architectureAuthoring";

export type ArchitectureTool = "select" | "wall" | "door" | "window";

export function ArchitectureToolbar(props: {
  floors: Floor[];
  activeFloorId: string;
  tool: ArchitectureTool;
  disabled?: boolean;
  onFloorChange: (floorId: string) => void;
  onToolChange: (tool: ArchitectureTool) => void;
}) {
  return (
    <div className="editor-mode-switch" role="group" aria-label="Architecture tools">
      <select
        aria-label="Architecture floor"
        value={props.activeFloorId}
        disabled={props.disabled}
        onChange={(event) => props.onFloorChange(event.target.value)}
      >
        {[...props.floors]
          .sort((left, right) => left.elevation - right.elevation)
          .map((floor) => (
            <option key={floor.id} value={floor.id}>
              {floor.name}
            </option>
          ))}
      </select>
      {(
        [
          ["select", "Select"],
          ["wall", "Wall"],
          ["door", "Door"],
          ["window", "Window"],
        ] as const
      ).map(([tool, label]) => (
        <button
          key={tool}
          type="button"
          className={props.tool === tool ? "active" : ""}
          disabled={props.disabled}
          onClick={() => props.onToolChange(tool)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        type="number"
        step={props.step ?? 0.1}
        value={Number.isFinite(props.value) ? props.value : 0}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) props.onChange(value);
        }}
      />
    </label>
  );
}

export function ArchitectureInspector(props: {
  wall?: Wall;
  opening?: Opening;
  onPatchWall: (
    change: Partial<Pick<Wall, "start" | "end" | "thickness" | "height">>,
  ) => void;
  onPatchOpening: (change: Partial<Opening>) => void;
  onMoveOpening: (x: number, z: number) => void;
  onAcceptWall: () => void;
  onRemoveWall: () => void;
  onAcceptOpening: () => void;
  onRemoveOpening: () => void;
}) {
  const wall = props.wall;
  if (wall)
    return (
      <>
        <h2>Wall properties</h2>
        <p>
          {wall.origin === "cad-auto"
            ? "CAD-backed wall. Any edit becomes a manual reviewed correction."
            : "Editable parametric wall. Changes stay reviewable until accepted."}
        </p>
        <div className="property-grid">
          <NumberField
            label="Start X (m)"
            value={wall.start[0]}
            onChange={(x) => props.onPatchWall({ start: [x, wall.start[1]] })}
          />
          <NumberField
            label="Start Z (m)"
            value={wall.start[1]}
            onChange={(z) => props.onPatchWall({ start: [wall.start[0], z] })}
          />
          <NumberField
            label="End X (m)"
            value={wall.end[0]}
            onChange={(x) => props.onPatchWall({ end: [x, wall.end[1]] })}
          />
          <NumberField
            label="End Z (m)"
            value={wall.end[1]}
            onChange={(z) => props.onPatchWall({ end: [wall.end[0], z] })}
          />
          <NumberField
            label="Thickness (m)"
            value={wall.thickness}
            step={0.01}
            onChange={(thickness) => props.onPatchWall({ thickness })}
          />
          <NumberField
            label="Height (m)"
            value={wall.height}
            onChange={(height) => props.onPatchWall({ height })}
          />
        </div>
        <small>
          Length {wallLength(wall).toFixed(2)} m · {wall.roomIds.length} room link
          {wall.roomIds.length === 1 ? "" : "s"}
        </small>
        <button
          className={wall.reviewed ? "" : "primary"}
          disabled={wall.reviewed}
          onClick={props.onAcceptWall}
        >
          {wall.reviewed ? "Reviewed" : "Accept wall"}
        </button>
        <button className="danger" onClick={props.onRemoveWall}>
          Remove wall
        </button>
      </>
    );

  const opening = props.opening;
  if (!opening) return null;
  return (
    <>
      <h2>
        {opening.kind === "window"
          ? "Window"
          : opening.kind === "door"
            ? "Door"
            : "Opening"}{" "}
        properties
      </h2>
      <p>Move and scale with the gizmo, or enter exact wall-opening dimensions.</p>
      <label>
        Opening type
        <select
          value={opening.kind}
          onChange={(event) =>
            props.onPatchOpening({ kind: event.target.value as Opening["kind"] })
          }
        >
          <option value="door">Door</option>
          <option value="window">Window</option>
          <option value="opening">Open passage</option>
        </select>
      </label>
      <div className="property-grid">
        <NumberField
          label="Position X (m)"
          value={opening.x}
          onChange={(x) => props.onMoveOpening(x, opening.z)}
        />
        <NumberField
          label="Position Z (m)"
          value={opening.z}
          onChange={(z) => props.onMoveOpening(opening.x, z)}
        />
        <NumberField
          label="Width (m)"
          value={opening.width}
          step={0.05}
          onChange={(width) => props.onPatchOpening({ width })}
        />
        <NumberField
          label="Height (m)"
          value={opening.height}
          step={0.05}
          onChange={(height) => props.onPatchOpening({ height })}
        />
        {opening.kind === "window" && (
          <NumberField
            label="Sill height (m)"
            value={opening.sillHeight ?? 0.9}
            step={0.05}
            onChange={(sillHeight) => props.onPatchOpening({ sillHeight })}
          />
        )}
      </div>
      <small>
        {opening.roomIds.length} room link{opening.roomIds.length === 1 ? "" : "s"} · rotation{" "}
        {opening.rotationY.toFixed(1)}°
      </small>
      <button
        className={opening.reviewed ? "" : "primary"}
        disabled={opening.reviewed}
        onClick={props.onAcceptOpening}
      >
        {opening.reviewed ? "Reviewed" : "Accept opening"}
      </button>
      <button className="danger" onClick={props.onRemoveOpening}>
        Remove opening
      </button>
    </>
  );
}

export function ArchitectureOutliner(props: {
  walls: Wall[];
  openings: Opening[];
  floorId?: string;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const walls = props.walls
    .filter((entry) => !props.floorId || entry.floorId === props.floorId)
    .slice(0, 120);
  const openings = props.openings
    .filter((entry) => !props.floorId || entry.floorId === props.floorId)
    .slice(0, 120);
  if (!walls.length && !openings.length) return null;
  return (
    <>
      <div className="section-label">ARCHITECTURE</div>
      <div className="room-tree site-element-tree">
        {walls.map((wall) => (
          <button
            type="button"
            key={wall.id}
            className={props.selected === wall.id ? "tree-room active" : "tree-room"}
            onClick={() => props.onSelect(wall.id)}
          >
            <span>{wall.reviewed ? "◉" : "○"} Wall</span>
            <small>
              {wallLength(wall).toFixed(2)} m · {wall.origin}
            </small>
          </button>
        ))}
        {openings.map((opening) => (
          <button
            type="button"
            key={opening.id}
            className={props.selected === opening.id ? "tree-room active" : "tree-room"}
            onClick={() => props.onSelect(opening.id)}
          >
            <span>{opening.reviewed ? "◉" : "○"} {opening.kind}</span>
            <small>
              {opening.width.toFixed(2)} × {opening.height.toFixed(2)} m
            </small>
          </button>
        ))}
      </div>
    </>
  );
}

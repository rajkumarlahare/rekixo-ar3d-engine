import { roomBoundaryPoints, type Room, type Scene } from "./domain";
import type { BatchRepeatPreview } from "./unitRepeat";

const COLORS = ["#68bce8", "#e8b26b", "#a699e5", "#75c9a8"];

/** A review of saved geometry, never an alternative architectural model. */
export default function FloorRoomReview({ scene, floorId, unit, selectedId, disabled,
  repeat, onUnit, onSelect, onReview, onReviewUnit, onCorrect, onRepeat, onClose,
}: {
  scene: Scene; floorId: string; unit: string; selectedId: string; disabled: boolean;
  repeat: BatchRepeatPreview;
  onUnit: (unit: string) => void; onSelect: (room: Room) => void;
  onReview: (room: Room, accepted: boolean) => void;
  onReviewUnit: (unit: string, accepted: boolean) => void;
  onCorrect: () => void; onRepeat: () => void; onClose: () => void;
}) {
  const rooms = scene.rooms.filter((room) => room.floorId === floorId);
  const units = [...new Set(rooms.map((room) => room.unit))].sort();
  const activeUnit = units.includes(unit) ? unit : units[0];
  const visible = rooms.filter((room) => room.unit === activeUnit);
  const selected = visible.find((room) => room.id === selectedId);
  const points = rooms.flatMap(roomBoundaryPoints);
  if (!points.length) return null;
  const minX = Math.min(...points.map(([x]) => x)) - 1;
  const minZ = Math.min(...points.map(([, z]) => z)) - 1;
  const width = Math.max(...points.map(([x]) => x)) - minX + 1;
  const depth = Math.max(...points.map(([, z]) => z)) - minZ + 1;
  return <section className="floor-room-review" aria-label="Floor room review">
    <header><div><strong>{scene.floors.find((floor) => floor.id === floorId)?.name} · Review rooms</strong>
      <small>{rooms.filter((room) => room.verified).length}/{rooms.length} accepted · Compare with your source plan</small></div>
      <button type="button" onClick={onClose}>Done</button></header>
    <div className="floor-review-units" aria-label="Review unit">
      {units.map((value, index) => <button type="button" key={value} aria-pressed={value === activeUnit}
        style={{ borderColor: COLORS[index % COLORS.length] }} onClick={() => onUnit(value)}>Unit {value}</button>)}
    </div>
    <svg viewBox={`${minX} ${minZ} ${width} ${depth}`} role="img" aria-label="Saved room layout by unit">
      {rooms.map((room) => <g key={room.id} opacity={room.unit === activeUnit ? 1 : 0.25}>
        <polygon points={roomBoundaryPoints(room).map((point) => point.join(",")).join(" ")}
          fill={COLORS[units.indexOf(room.unit) % COLORS.length]} fillOpacity={0.25}
          stroke={room.id === selectedId ? "#fff" : COLORS[units.indexOf(room.unit) % COLORS.length]}
          strokeWidth={room.id === selectedId ? 0.12 : 0.04} />
        <text x={room.x} y={room.z} textAnchor="middle" fontSize={0.32} fill="currentColor">{room.name}</text>
      </g>)}
    </svg>
    <div className="floor-review-unit-action">
      <span>
        <strong>Unit ${activeUnit}</strong>
        <small>${visible.filter((room) => room.verified).length}/${visible.length} rooms accepted</small>
      </span>
      <button type="button" className="primary"
        disabled={disabled || !visible.length || visible.every((room) => room.verified)}
        onClick={() => onReviewUnit(activeUnit, true)}>
        Accept whole unit
      </button>
    </div>
    <div className="floor-review-rooms" aria-label="Rooms to review">
      {visible.map((room) => <button type="button" key={room.id} aria-pressed={room.id === selectedId}
        onClick={() => onSelect(room)}><span>{room.name}</span><small>{room.verified ? "Accepted" : "Needs review"}</small></button>)}
    </div>
    {selected ? <div className="floor-review-decision">
      <strong>{selected.unit} · {selected.name}</strong>
      <small>{selected.polygon?.length ? "Outline bounds" : "Size"}: {selected.width.toFixed(3)} × {selected.depth.toFixed(3)} m</small>
      <div><button type="button" className="primary" disabled={disabled || selected.verified}
        onClick={() => onReview(selected, true)}>Accept room</button>
        <button type="button" disabled={disabled} onClick={() => { onReview(selected, false); onCorrect(); }}>Needs correction</button></div>
      <details><summary>Source & verification</summary><p>{selected.source}</p>
        <small>Acceptance records your geometry review. Source evidence remains unchanged.</small></details>
    </div> : <p>Select a room to compare its outline and accept or correct it.</p>}
    {repeat.rows.length > 0 && <details className="floor-review-repeat"><summary>Repeat floors · {repeat.readyTargets} ready</summary>
      <p>{repeat.note}</p>
      {repeat.rows.map((row) => <div key={row.key}><b>{row.sourceUnit} → {row.targetUnit}</b>
        <small>{row.targetFloorName} · {row.reason}</small></div>)}
      <button type="button" disabled={disabled || !repeat.readyTargets} onClick={onRepeat}>
        Generate {repeat.readyTargets} units · {repeat.roomsToCreate} draft rooms</button>
    </details>}
  </section>;
}

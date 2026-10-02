import type { DragEvent } from "react";
import { catalog, type Kind, type Room } from "./domain";
import { REKIXO_FURNITURE_MIME } from "./canvasFurniturePlacement";

export default function FurnitureShelf({
  room,
  disabled,
  activeKind,
  onPick,
}: {
  room?: Room;
  disabled: boolean;
  activeKind?: Kind;
  onPick: (kind: Kind) => void;
}) {
  const drag = (event: DragEvent<HTMLButtonElement>, kind: Kind) => {
    if (!room || disabled) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      REKIXO_FURNITURE_MIME,
      JSON.stringify({ kind, roomId: room.id }),
    );
  };

  return (
    <div className="simple-furniture-grid" role="group" aria-label="Furniture placement library">
      {Object.entries(catalog).map(([kind, definition]) => {
        const key = kind as Kind;
        const active = activeKind === key;
        return (
          <button
            key={kind}
            type="button"
            draggable={Boolean(room) && !disabled}
            disabled={!room || disabled}
            className={active ? "furniture-card active" : "furniture-card"}
            aria-pressed={active}
            title={
              room
                ? "Drag to the canvas, or tap then tap inside the room."
                : "Select a room first."
            }
            onDragStart={(event) => drag(event, key)}
            onClick={() => onPick(key)}
          >
            <span className={`furniture-icon ${kind}`} aria-hidden="true" />
            <span>
              <b>{definition.name}</b>
              <small>
                {definition.width} × {definition.depth} m
              </small>
            </span>
            <em>{active ? "Tap room…" : "Drag / tap"}</em>
          </button>
        );
      })}
    </div>
  );
}

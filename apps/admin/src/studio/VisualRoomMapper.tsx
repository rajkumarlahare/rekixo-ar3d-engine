import type { Room, Scene } from "./domain";

export type RoomMapAction = "idle" | "create" | "reshape";

export default function VisualRoomMapper({
  scene,
  floorId,
  unit,
  roomName,
  action,
  snap,
  selectedRoom,
  disabled,
  onFloor,
  onUnit,
  onRoomName,
  onAction,
  onSnap,
  onClone,
  onMirror,
  onClose,
}: {
  scene: Scene;
  floorId: string;
  unit: string;
  roomName: string;
  action: RoomMapAction;
  snap: boolean;
  selectedRoom?: Room;
  disabled?: boolean;
  onFloor: (floorId: string) => void;
  onUnit: (unit: string) => void;
  onRoomName: (name: string) => void;
  onAction: (action: RoomMapAction) => void;
  onSnap: (value: boolean) => void;
  onClone: () => void;
  onMirror: (axis: "x" | "z") => void;
  onClose: () => void;
}) {
  const floorRooms = scene.rooms.filter((room) => room.floorId === floorId);
  const unitRooms = floorRooms.filter((room) => room.unit === unit.trim());
  const area = unitRooms.reduce(
    (sum, room) => sum + room.width * room.depth,
    0,
  );
  const canMirror = Boolean(
    selectedRoom &&
      selectedRoom.floorId === floorId &&
      unitRooms.length > 1,
  );

  return (
    <section className="room-mapper" aria-label="Visual unit and room mapper">
      <header className="room-mapper-head">
        <div>
          <small>VISUAL UNIT / ROOM MAPPER</small>
          <strong>Mouse से plan पर rooms बनाइए</strong>
        </div>
        <div>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </header>

      <div className="room-mapper-body">
        <div className="room-mapper-fields">
          <label>
            Floor
            <select
              value={floorId}
              disabled={disabled}
              onChange={(event) => onFloor(event.target.value)}
            >
              {[...scene.floors]
                .sort((left, right) => left.elevation - right.elevation)
                .map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Unit / flat
            <input
              value={unit}
              disabled={disabled}
              list="room-mapper-units"
              onChange={(event) => onUnit(event.target.value)}
              placeholder="e.g. 101"
            />
          </label>
          <datalist id="room-mapper-units">
            {[...new Set(floorRooms.map((room) => room.unit))]
              .filter(Boolean)
              .map((value) => (
                <option key={value} value={value} />
              ))}
          </datalist>
          <label>
            Room label
            <input
              value={roomName}
              disabled={disabled}
              onChange={(event) => onRoomName(event.target.value)}
              placeholder="Living / Bedroom / Kitchen"
            />
          </label>
        </div>

        <div className="room-mapper-tools">
          <button
            type="button"
            className={action === "create" ? "active primary" : ""}
            disabled={disabled || !floorId || !unit.trim()}
            onClick={() => onAction(action === "create" ? "idle" : "create")}
          >
            + Draw room
          </button>
          <button
            type="button"
            className={action === "reshape" ? "active" : ""}
            disabled={
              disabled ||
              !selectedRoom ||
              selectedRoom.floorId !== floorId
            }
            onClick={() =>
              onAction(action === "reshape" ? "idle" : "reshape")
            }
          >
            Reshape selected
          </button>
          <button
            type="button"
            disabled={disabled || !selectedRoom}
            onClick={onClone}
          >
            Clone + drag
          </button>
          <button
            type="button"
            disabled={disabled || !canMirror}
            onClick={() => onMirror("x")}
            title="Mirror selected room around the current unit centre"
          >
            Mirror X
          </button>
          <button
            type="button"
            disabled={disabled || !canMirror}
            onClick={() => onMirror("z")}
            title="Mirror selected room around the current unit centre"
          >
            Mirror Z
          </button>
          <label className="room-mapper-snap">
            <input
              type="checkbox"
              checked={snap}
              disabled={disabled}
              onChange={(event) => onSnap(event.target.checked)}
            />
            Snap to grid & room edges
          </label>
        </div>

        <div className="room-mapper-status">
          <span>
            <b>{unitRooms.length}</b> rooms in {unit.trim() || "unit"}
          </span>
          <span>
            <b>{area.toFixed(2)} m²</b> rectangular mapped area
          </span>
          <span>
            {selectedRoom ? (
              <>
                Selected <b>{selectedRoom.name}</b> ·{" "}
                {selectedRoom.width.toFixed(2)} ×{" "}
                {selectedRoom.depth.toFixed(2)} m
              </>
            ) : (
              "Select a room to clone, reshape or mirror"
            )}
          </span>
        </div>

        <div className="room-mapper-help">
          {action === "create" ? (
            <b>
              Viewport पर click-drag करें. Width, depth, centre और area Rekixo
              खुद calculate करेगा.
            </b>
          ) : action === "reshape" ? (
            <b>
              Selected room की नई boundary viewport पर drag करें. Existing room
              metadata और furniture relationship सुरक्षित रहेगा.
            </b>
          ) : (
            <span>
              Draw Room चुनें या existing room select करें. Exact numbers
              Advanced Inspector में उपलब्ध हैं, लेकिन normal mapping mouse-first
              है.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

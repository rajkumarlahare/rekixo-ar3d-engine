import type { ModelNodeSummary } from "./SceneCanvas";
import type {
  Floor,
  ModelNodeSemantic,
  ModelNodeTag,
  Room,
} from "./domain";

export interface ModelNodeInspectorProps {
  mesh: string;
  selectedNode?: ModelNodeSummary;
  selectedTag?: ModelNodeTag;
  taggedCount: number;
  totalCount: number;
  floors: Floor[];
  rooms: Room[];
  currentRoom?: Room;
  onPatchTag: (change: Partial<ModelNodeTag>) => void;
  onClearSemantic: () => void;
  onClearTag: () => void;
  onBindRoom: (roomId: string) => void;
  onFocus: () => void;
}

export default function ModelNodeInspector({
  mesh,
  selectedNode,
  selectedTag,
  taggedCount,
  totalCount,
  floors,
  rooms,
  currentRoom,
  onPatchTag,
  onClearSemantic,
  onClearTag,
  onBindRoom,
  onFocus,
}: ModelNodeInspectorProps) {
  const compatibleRooms = rooms.filter(
    (room) => !selectedTag?.floorId || room.floorId === selectedTag.floorId,
  );
  const units = [
    ...new Set(compatibleRooms.map((room) => room.unit).filter(Boolean)),
  ];

  return (
    <>
      <h2>{mesh}</h2>
      <p>
        Source geometry stays read-only. Tag this exact source mesh to a floor,
        unit or room so isolation and future project navigation use reviewed
        semantics instead of guesses.
      </p>
      <label>
        Source mesh
        <input
          readOnly
          value={
            selectedNode
              ? `${selectedNode.name} · occurrence ${selectedNode.occurrence}`
              : mesh
          }
        />
      </label>
      {selectedNode && (
        <>
          <div className="semantic-tag-status">
            <span>
              Tagged {taggedCount}/{totalCount}
            </span>
            <span>Source Y {selectedNode.centreY.toFixed(3)}</span>
          </div>
          <div className="semantic-tag-status">
            <span>
              Architecture{" "}
              <b>
                {selectedTag?.semantic
                  ? selectedTag.semantic.toUpperCase()
                  : "UNASSIGNED"}
              </b>
            </span>
            <span>
              {selectedTag?.semanticAssignment === "auto"
                ? `Auto ${Math.round(
                    (selectedTag.semanticConfidence ?? 0) * 100,
                  )}%`
                : selectedTag?.semanticAssignment === "manual"
                  ? "Reviewed manually"
                  : "Needs review"}
            </span>
          </div>
          <label>
            Architectural label
            <select
              value={selectedTag?.semantic ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  onClearSemantic();
                  return;
                }
                onPatchTag({ semantic: value as ModelNodeSemantic });
              }}
            >
              <option value="">Unassigned</option>
              <option value="wall">Wall</option>
              <option value="door">Door</option>
              <option value="window">Window</option>
              <option value="opening">Other opening</option>
              <option value="ignore">Ignore candidate</option>
            </select>
          </label>
          <label>
            Floor tag
            <select
              value={selectedTag?.floorId ?? ""}
              onChange={(event) =>
                onPatchTag({ floorId: event.target.value })
              }
            >
              <option value="">Unassigned</option>
              {[...floors]
                .sort((left, right) => left.elevation - right.elevation)
                .map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.name} · {floor.elevation}m
                  </option>
                ))}
            </select>
          </label>
          <label>
            Unit / flat tag
            <input
              value={selectedTag?.unit ?? ""}
              onChange={(event) => onPatchTag({ unit: event.target.value })}
              placeholder="e.g. 101"
              list="model-node-units"
            />
          </label>
          <datalist id="model-node-units">
            {units.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
          <label>
            Exact room binding
            <select
              value={selectedTag?.roomId ?? ""}
              onChange={(event) => {
                const roomId = event.target.value;
                if (roomId) onBindRoom(roomId);
                else onPatchTag({ roomId: "" });
              }}
            >
              <option value="">No exact room</option>
              {compatibleRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.unit} · {room.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!selectedTag}
            onClick={onClearTag}
          >
            Clear semantic tag
          </button>
        </>
      )}
      <button
        disabled={!currentRoom}
        onClick={() => {
          if (currentRoom) onBindRoom(currentRoom.id);
        }}
      >
        Bind mesh to current room
      </button>
      <button type="button" onClick={onFocus}>
        Focus selected mesh
      </button>
    </>
  );
}

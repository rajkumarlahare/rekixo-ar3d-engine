import { useEffect, useMemo, useState } from "react";
import { roomArea, type Room, type Scene } from "./domain";
import type { RoomSheetRow } from "./roomSheet";
import type { BatchRepeatPreview } from "./unitRepeat";

export interface OpeningWorkflowStatus {
  analyzed: boolean;
  approved: number;
  ready: number;
  review: number;
  detected: number;
}

export type RoomMapAction =
  | "idle"
  | "stamp"
  | "create"
  | "polygon"
  | "reshape"
  | "edit-polygon";

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
  roomSheetRows,
  mappedRoomSheetKeys,
  selectedRoomSheetKey,
  roomSheetIssues,
  onRoomSheetSelect,
  onPrepareSuggestedLayout,
  batchRepeatPreview,
  onGenerateBatchRepeat,
  openingWorkflow,
  onAnalyzeReadyOpenings,
  onReviewOpenings,
  onRepeatUnit,
  onClose,
  canPrepare = true,
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
  roomSheetRows: RoomSheetRow[];
  mappedRoomSheetKeys: Set<string>;
  selectedRoomSheetKey: string;
  roomSheetIssues: string[];
  onRoomSheetSelect: (row: RoomSheetRow) => void;
  onPrepareSuggestedLayout: (floorId: string) => void;
  batchRepeatPreview?: BatchRepeatPreview;
  onGenerateBatchRepeat: () => void;
  openingWorkflow: OpeningWorkflowStatus;
  onAnalyzeReadyOpenings: () => void;
  onReviewOpenings: () => void;
  onRepeatUnit: (targetFloorId: string, targetUnit: string) => void;
  onClose: () => void;
  canPrepare?: boolean;
}) {
  const floorRooms = scene.rooms.filter((room) => room.floorId === floorId);
  const unmappedRows = roomSheetRows.filter(
    (row) => !mappedRoomSheetKeys.has(row.key),
  );
  const selectedSheetRow = roomSheetRows.find(
    (row) => row.key === selectedRoomSheetKey,
  );
  const suggestedRows = unmappedRows.filter(
    (row) =>
      row.origin === "profile" &&
      typeof row.suggestedX === "number" &&
      Number.isFinite(row.suggestedX) &&
      typeof row.suggestedZ === "number" &&
      Number.isFinite(row.suggestedZ),
  );
  const mappedSheetCount = roomSheetRows.length - unmappedRows.length;
  const unitRooms = floorRooms.filter((room) => room.unit === unit.trim());
  const area = unitRooms.reduce((sum, room) => sum + roomArea(room), 0);
  const orderedFloors = useMemo(
    () => [...scene.floors].sort((left, right) => left.elevation - right.elevation),
    [scene.floors],
  );
  const sourceFloorIndex = orderedFloors.findIndex((floor) => floor.id === floorId);
  const defaultTarget =
    orderedFloors[sourceFloorIndex + 1]?.id ??
    orderedFloors.find((floor) => floor.id !== floorId)?.id ??
    "";
  const suggestUnit = (value: string, targetFloorId: string) => {
    const sourceIndex = orderedFloors.findIndex((floor) => floor.id === floorId);
    const targetIndex = orderedFloors.findIndex((floor) => floor.id === targetFloorId);
    const match = value.trim().match(/^(\D*)(\d{3,})(\D*)$/);
    if (!match || sourceIndex < 0 || targetIndex < 0)
      return value.trim() ? `${value.trim()} copy` : "Unit";
    const number = Number(match[2]);
    if (!Number.isFinite(number))
      return `${value.trim()} copy`;
    const delta = targetIndex - sourceIndex;
    return `${match[1]}${number + delta * 100}${match[3]}`;
  };
  const [repeatFloorId, setRepeatFloorId] = useState(defaultTarget);
  const [repeatUnit, setRepeatUnit] = useState(
    suggestUnit(unit, defaultTarget),
  );
  useEffect(() => {
    const target =
      orderedFloors.find((floor) => floor.id === repeatFloorId && floor.id !== floorId)
        ?.id ?? defaultTarget;
    setRepeatFloorId(target);
    setRepeatUnit(suggestUnit(unit, target));
  }, [floorId, unit, defaultTarget, orderedFloors]);
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
        <section className="room-sheet-queue" aria-label="Unmapped rooms">
          <div className="room-sheet-queue-head">
            <div>
              <small>ROOM SHEET → VISUAL PLACEMENT</small>
              <b>Unmapped Rooms</b>
              <span>
                {roomSheetRows.length
                  ? `${unmappedRows.length} left · ${mappedSheetCount} mapped`
                  : "Attach CSV/TSV for a reusable room queue"}
              </span>
            </div>
            {selectedSheetRow && (
              <div className="room-sheet-selected">
                <strong>{selectedSheetRow.unit} · {selectedSheetRow.name}</strong>
                <small>
                  {selectedSheetRow.width.toFixed(2)} × {selectedSheetRow.depth.toFixed(2)} m
                  {selectedSheetRow.height
                    ? ` · H ${selectedSheetRow.height.toFixed(2)} m`
                    : ""}
                </small>
                <em>Click/tap once on the plan to place exact size</em>
              </div>
            )}
          </div>
          {canPrepare && suggestedRows.length > 0 && (
            <div className="room-sheet-suggested-action">
              <span>
                <strong>{suggestedRows.length} reconstructed placements ready</strong>
                <small>
                  Rekixo इन्हें draft position पर रख देगा; existing rooms untouched
                  रहेंगे और आप mouse/touch से correction कर सकते हैं.
                </small>
              </span>
              <button
                type="button"
                className="primary"
                disabled={disabled || !floorId}
                onClick={() => onPrepareSuggestedLayout(floorId)}
              >
                Prepare suggested floor
              </button>
            </div>
          )}
          {unmappedRows.length > 0 ? (
            <div className="room-sheet-queue-list">
              {unmappedRows.map((row) => (
                <button
                  type="button"
                  key={row.key}
                  className={
                    row.key === selectedRoomSheetKey
                      ? "room-sheet-row active"
                      : "room-sheet-row"
                  }
                  disabled={disabled}
                  onClick={() => onRoomSheetSelect(row)}
                  title={row.sourceNote}
                >
                  <span>
                    <b>{row.unit}</b>
                    <strong>{row.name}</strong>
                  </span>
                  <small>
                    {row.width.toFixed(2)} × {row.depth.toFixed(2)} m
                    {row.floorLabel ? ` · ${row.floorLabel}` : ""}
                  </small>
                  <i>{row.origin === "csv" ? "CSV" : "PROJECT"}</i>
                </button>
              ))}
            </div>
          ) : roomSheetRows.length ? (
            <div className="room-sheet-complete">
              ✓ Room sheet complete — all {roomSheetRows.length} rows are mapped.
            </div>
          ) : (
            <div className="room-sheet-empty">
              CSV columns: Floor (optional), Unit/Flat, Room, Width + Depth
              or Size. Metres, cm, mm and feet/inches are accepted.
            </div>
          )}
          {roomSheetIssues.length > 0 && (
            <details className="room-sheet-issues">
              <summary>{roomSheetIssues.length} room-sheet row warning{roomSheetIssues.length === 1 ? "" : "s"}</summary>
              {roomSheetIssues.slice(0, 12).map((issue) => (
                <small key={issue}>{issue}</small>
              ))}
            </details>
          )}
        </section>

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
            className={action === "stamp" ? "active primary" : ""}
            disabled={disabled || !selectedSheetRow || !floorId}
            onClick={() => onAction(action === "stamp" ? "idle" : "stamp")}
            title="Place the selected room at its exact room-sheet size"
          >
            ◎ Place exact room
          </button>
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
            className={action === "polygon" ? "active primary" : ""}
            disabled={disabled || !floorId || !unit.trim()}
            onClick={() => onAction(action === "polygon" ? "idle" : "polygon")}
            title="Click each room corner for L-shape or irregular rooms"
          >
            + Draw corners
          </button>
          <button
            type="button"
            className={action === "reshape" ? "active" : ""}
            disabled={
              disabled ||
              !selectedRoom ||
              selectedRoom.floorId !== floorId ||
              Boolean(selectedRoom.polygon?.length)
            }
            onClick={() =>
              onAction(action === "reshape" ? "idle" : "reshape")
            }
          >
            Reshape selected
          </button>
          <button
            type="button"
            className={action === "edit-polygon" ? "active" : ""}
            disabled={
              disabled ||
              !selectedRoom?.polygon?.length ||
              selectedRoom.floorId !== floorId
            }
            onClick={() =>
              onAction(
                action === "edit-polygon" ? "idle" : "edit-polygon",
              )
            }
          >
            Edit corners
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
            Snap to grid, walls & vertices
          </label>
        </div>

        <div className="room-mapper-status">
          <span>
            <b>{unitRooms.length}</b> rooms in {unit.trim() || "unit"}
          </span>
          <span>
            <b>{area.toFixed(2)} m²</b> mapped area
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
          {action === "stamp" && selectedSheetRow ? (
            <b>
              {selectedSheetRow.unit} · {selectedSheetRow.name} is ready at{" "}
              {selectedSheetRow.width.toFixed(2)} × {selectedSheetRow.depth.toFixed(2)} m.
              Plan पर सिर्फ click/tap करें; size Rekixo रखेगा.
            </b>
          ) : action === "create" ? (
            <b>
              Viewport पर click-drag करें. Width, depth, centre और area Rekixo
              खुद calculate करेगा.
            </b>
          ) : action === "polygon" ? (
            <b>
              Irregular room के corners click करें. Nearby wall/vertex पर snap
              होगा. First corner फिर click करें या Enter दबाएँ; Esc cancels.
            </b>
          ) : action === "edit-polygon" ? (
            <b>
              Purple corner handle को mouse से drag करें. Nearby mapped wall और
              vertex पर snap होगा; invalid/self-crossing shape save नहीं होगी.
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

        <section
          className="room-opening-workflow"
          aria-label="Doors windows and walkthrough preparation"
        >
          <div className="room-opening-workflow-head">
            <div>
              <small>DOORS / WINDOWS → WALKTHROUGH</small>
              <b>One-click opening preparation</b>
              <span>
                Fresh model scan + mapped-wall matching. केवल confident,
                dimension-plausible associations approve होंगे.
              </span>
            </div>
            <button
              type="button"
              className="primary"
              disabled={disabled || !scene.modelId || scene.rooms.length === 0}
              onClick={onAnalyzeReadyOpenings}
            >
              Analyze & approve ready
            </button>
          </div>
          <div className="room-opening-workflow-stats">
            <span>
              Approved <b>{openingWorkflow.approved}</b>
            </span>
            <span>
              Ready <b>{openingWorkflow.ready}</b>
            </span>
            <span>
              Review <b>{openingWorkflow.review}</b>
            </span>
            <span>
              Detected <b>{openingWorkflow.detected}</b>
            </span>
          </div>
          {!scene.modelId ? (
            <p>Select/lock the project model first.</p>
          ) : !scene.rooms.length ? (
            <p>Prepare and review the typical-floor rooms first.</p>
          ) : openingWorkflow.review > 0 ? (
            <div className="room-opening-workflow-review">
              <span>
                {openingWorkflow.review} unclear candidate
                {openingWorkflow.review === 1 ? "" : "s"} auto-approved नहीं
                हुए.
              </span>
              <button type="button" disabled={disabled} onClick={onReviewOpenings}>
                Review unclear
              </button>
            </div>
          ) : openingWorkflow.analyzed ? (
            <p>
              No unclear opening candidate remains from the latest analysis.
              Reviewed shared doors automatically power room-to-room walkthrough.
            </p>
          ) : (
            <p>
              Typical floor correction के बाद यह एक button चलाएँ. Existing
              reviewed openings और manual labels preserve रहेंगे.
            </p>
          )}
        </section>

        {batchRepeatPreview?.rows.length ? (
          <section
            className="room-mapper-batch-repeat"
            aria-label="Repeated floor preview"
          >
            <div className="room-mapper-batch-head">
              <div>
                <small>REPEAT TYPICAL FLOOR · PREVIEW FIRST</small>
                <b>{batchRepeatPreview.label ?? "Profile repeat plan"}</b>
                <span>
                  {batchRepeatPreview.readyTargets} ready ·{" "}
                  {batchRepeatPreview.existingTargets} existing ·{" "}
                  {batchRepeatPreview.blockedTargets} review
                </span>
              </div>
              <button
                type="button"
                className="primary"
                disabled={disabled || batchRepeatPreview.readyTargets === 0}
                onClick={onGenerateBatchRepeat}
              >
                Generate {batchRepeatPreview.readyTargets} unit
                {batchRepeatPreview.readyTargets === 1 ? "" : "s"} ·{" "}
                {batchRepeatPreview.roomsToCreate} rooms
              </button>
            </div>
            {batchRepeatPreview.note && (
              <p className="room-mapper-batch-note">
                {batchRepeatPreview.note}
              </p>
            )}
            <div className="room-mapper-batch-grid">
              {batchRepeatPreview.rows.map((row) => (
                <div
                  key={row.key}
                  className={`room-mapper-batch-row ${row.status}`}
                  title={row.reason}
                >
                  <span>
                    <b>{row.sourceUnit}</b>
                    <i>→</i>
                    <strong>{row.targetUnit}</strong>
                  </span>
                  <small>{row.targetFloorName ?? "Missing target floor"}</small>
                  <em>
                    {row.status === "ready"
                      ? `READY · ${row.sourceRoomCount} rooms`
                      : row.status === "existing"
                        ? "SKIP · EXISTING"
                        : "REVIEW"}
                  </em>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {orderedFloors.length > 1 && unitRooms.length > 0 && (
          <details className="room-mapper-repeat-fallback">
            <summary>Manual single-unit repeat fallback</summary>
            <div className="room-mapper-repeat">
              <div>
                <small>MANUAL REPEAT</small>
                <b>एक mapped unit को चुने हुए floor पर copy करें</b>
              </div>
              <label>
                Target floor
                <select
                  value={repeatFloorId}
                  disabled={disabled}
                  onChange={(event) => {
                    const target = event.target.value;
                    setRepeatFloorId(target);
                    setRepeatUnit(suggestUnit(unit, target));
                  }}
                >
                  {orderedFloors
                    .filter((floor) => floor.id !== floorId)
                    .map((floor) => (
                      <option key={floor.id} value={floor.id}>
                        {floor.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Target unit
                <input
                  value={repeatUnit}
                  disabled={disabled}
                  onChange={(event) => setRepeatUnit(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={
                  disabled ||
                  !repeatFloorId ||
                  !repeatUnit.trim() ||
                  repeatFloorId === floorId
                }
                onClick={() => onRepeatUnit(repeatFloorId, repeatUnit.trim())}
              >
                Repeat layout
              </button>
              <small>
                Fallback only. Existing target floor/unit is never overwritten.
              </small>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

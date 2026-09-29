import {
  reviewedDoorConnections,
  type Room,
  type Scene,
} from "./domain";

export interface RoomNavigationPanelProps {
  scene: Scene;
  room: Room;
  onWalkRoom: (room: Room) => void;
  onRemoveOpening: (openingId: string) => void;
}

export default function RoomNavigationPanel({
  scene,
  room,
  onWalkRoom,
  onRemoveOpening,
}: RoomNavigationPanelProps) {
  const connections = reviewedDoorConnections(scene, room.id).flatMap(
    (connection) => {
      const target = scene.rooms.find(
        (candidate) => candidate.id === connection.toRoomId,
      );
      return target ? [{ ...connection, room: target }] : [];
    },
  );
  const openings = (scene.openings ?? []).filter((opening) =>
    opening.roomIds.includes(room.id),
  );

  return (
    <>
      <section
        className="room-door-connectivity"
        aria-label="Reviewed walkthrough connections"
      >
        <div className="section-label">WALKTHROUGH CONNECTIONS</div>
        {connections.length ? (
          connections.map((connection) => (
            <div key={connection.openingId}>
              <span>
                <b>Reviewed door</b>
                <small>
                  Connects to {connection.room.unit} · {connection.room.name}
                </small>
              </span>
              <button
                type="button"
                onClick={() => onWalkRoom(connection.room)}
              >
                Walk there
              </button>
            </div>
          ))
        ) : (
          <small>
            No reviewed shared doors connect this room to another mapped room.
          </small>
        )}
      </section>

      <section
        className="room-opening-list"
        aria-label="Approved room openings"
      >
        <div className="section-label">APPROVED OPENINGS</div>
        {openings.length ? (
          openings.map((opening) => (
            <div key={opening.id}>
              <span>
                <b>{opening.kind.toUpperCase()}</b>
                <small>
                  {opening.width.toFixed(2)} × {opening.height.toFixed(2)} m
                  {opening.kind === "window" &&
                  opening.sillHeight !== undefined
                    ? ` · sill ${opening.sillHeight.toFixed(2)} m`
                    : ""}
                </small>
              </span>
              <span>
                {opening.roomIds.length === 2
                  ? "Shared wall"
                  : "Exterior / single-room wall"}
              </span>
              <button
                type="button"
                className="danger"
                onClick={() => onRemoveOpening(opening.id)}
              >
                Remove
              </button>
            </div>
          ))
        ) : (
          <small>No approved door/window associations for this room.</small>
        )}
      </section>
    </>
  );
}

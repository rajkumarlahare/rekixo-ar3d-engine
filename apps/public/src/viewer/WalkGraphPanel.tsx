import type {
  PublicWalkthroughGraph,
  PublicWalkthroughRoom,
} from "@rekixo/3d-contracts";
import { publicWalkConnections } from "./walkthrough";

export interface WalkGraphPanelProps {
  walkthrough: PublicWalkthroughGraph;
  activeRoom: PublicWalkthroughRoom;
  notice?: string;
  onEnterRoom: (roomId: string) => void;
}

export default function WalkGraphPanel({
  walkthrough,
  activeRoom,
  notice = "",
  onEnterRoom,
}: WalkGraphPanelProps) {
  const connections = publicWalkConnections(walkthrough, activeRoom.id);
  const connectedRoomIds = new Set(
    connections.map((connection) => connection.toRoomId),
  );
  const destinations = connections.flatMap((connection) => {
    const room = walkthrough.rooms.find(
      (candidate) => candidate.id === connection.toRoomId,
    );
    return room ? [{ ...connection, room }] : [];
  });
  const floorRooms = walkthrough.rooms.filter(
    (room) => room.floorId === activeRoom.floorId,
  );
  const mapPoints = floorRooms.flatMap((room) => room.boundary);
  const mapPadding = mapPoints.length
    ? 0.45 / Math.max(walkthrough.metresPerUnit, 0.0001)
    : 0.5;
  const mapMinX = mapPoints.length
    ? Math.min(...mapPoints.map((point) => point[0])) - mapPadding
    : -1;
  const mapMaxX = mapPoints.length
    ? Math.max(...mapPoints.map((point) => point[0])) + mapPadding
    : 1;
  const mapMinZ = mapPoints.length
    ? Math.min(...mapPoints.map((point) => point[1])) - mapPadding
    : -1;
  const mapMaxZ = mapPoints.length
    ? Math.max(...mapPoints.map((point) => point[1])) + mapPadding
    : 1;
  const mapWidth = Math.max(mapMaxX - mapMinX, 0.1);
  const mapHeight = Math.max(mapMaxZ - mapMinZ, 0.1);

  return (
    <aside className="viewer-walk-graph" aria-label="Reviewed room navigation">
      <div className="viewer-walk-graph__head">
        <span>REVIEWED ROOM GRAPH</span>
        <strong>
          {activeRoom.unit} · {activeRoom.name}
        </strong>
        <small>
          {notice ||
            `${destinations.length} reviewed door connection${destinations.length === 1 ? "" : "s"}`}
        </small>
      </div>
      <svg
        className="viewer-walk-map"
        viewBox={`${mapMinX} ${-mapMaxZ} ${mapWidth} ${mapHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Current floor room mini-map"
      >
        {floorRooms.map((room) => {
          const current = room.id === activeRoom.id;
          const connected = connectedRoomIds.has(room.id);
          const points = room.boundary
            .map(([x, z]) => `${x},${-z}`)
            .join(" ");
          return (
            <polygon
              key={room.id}
              points={points}
              className={
                current
                  ? "viewer-walk-map__room viewer-walk-map__room--current"
                  : connected
                    ? "viewer-walk-map__room viewer-walk-map__room--connected"
                    : "viewer-walk-map__room"
              }
              tabIndex={connected ? 0 : undefined}
              role={connected ? "button" : undefined}
              aria-label={
                connected
                  ? `Enter ${room.unit} ${room.name}`
                  : `${room.unit} ${room.name}`
              }
              onClick={() => {
                if (connected) onEnterRoom(room.id);
              }}
              onKeyDown={(event) => {
                if (
                  connected &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  onEnterRoom(room.id);
                }
              }}
            >
              <title>
                {room.unit} · {room.name}
              </title>
            </polygon>
          );
        })}
        {walkthrough.doors
          .filter(
            (door) =>
              door.floorId === activeRoom.floorId &&
              door.roomIds.includes(activeRoom.id),
          )
          .map((door) => (
            <circle
              key={door.id}
              cx={door.x}
              cy={-door.z}
              r={0.12 / Math.max(walkthrough.metresPerUnit, 0.0001)}
              className="viewer-walk-map__door"
            >
              <title>Reviewed door</title>
            </circle>
          ))}
      </svg>
      <div className="viewer-walk-destinations">
        <span>CONNECTED ROOMS</span>
        {destinations.length ? (
          destinations.map(({ openingId, room }) => (
            <button
              type="button"
              key={openingId}
              onClick={() => onEnterRoom(room.id)}
            >
              <span>{room.unit}</span>
              <strong>{room.name}</strong>
              <small>via reviewed door</small>
            </button>
          ))
        ) : (
          <small>No reviewed shared door connects this room.</small>
        )}
      </div>
    </aside>
  );
}

export default function CanvasAuthoringHints({
  furniture,
  wall,
  stamp,
  room,
  polygon,
}: {
  furniture: boolean;
  wall: boolean;
  stamp: boolean;
  room: boolean;
  polygon: boolean;
}) {
  if (furniture)
    return (
      <div className="room-draw-hint">
        Tap inside the room to place · desktop: drag a furniture card onto the
        canvas · Esc cancels
      </div>
    );
  if (wall)
    return (
      <div className="room-draw-hint">
        Drag wall start → end · endpoint/midpoint/intersection snap + angle assist
        · release to place
      </div>
    );
  if (stamp)
    return (
      <div className="room-draw-hint">
        Click or tap once to place the exact room-sheet size · drag later to
        fine-tune
      </div>
    );
  if (room)
    return (
      <div className="room-draw-hint">
        Drag from one room corner to the opposite corner · release to map
      </div>
    );
  if (polygon)
    return (
      <div className="room-draw-hint">
        Click room corners · wall/vertex snap is active · click first corner or
        press Enter to finish · Esc cancels
      </div>
    );
  return null;
}

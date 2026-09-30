import type { Project, Room } from "./domain";
import { isRemovableUnsourcedDraft } from "./reviewDrafts";
import type { StudioReadiness } from "./readiness";

function evidenceMeta(room: Room) {
  const label = room.sourcePackSourceId
    ? room.sourcePackSourceId
    : room.sourceAssetId
      ? "Attached project asset"
      : room.source.trim()
        ? "Source note"
        : "No source";
  const detail = room.sourceClaimIds?.length
    ? `${room.sourceClaimIds.length} source claim(s)`
    : room.source.trim()
      ? room.source.slice(0, 100)
      : "No evidence is attached to this draft";
  return { label, detail };
}

function EvidenceRow({
  project,
  room,
  onOpenRoom,
  onRemoveDraft,
}: {
  project: Project;
  room: Room;
  onOpenRoom: (roomId: string) => void;
  onRemoveDraft: (roomId: string) => void;
}) {
  const floor = project.scene.floors.find(
    (candidate) => candidate.id === room.floorId,
  );
  const evidence = evidenceMeta(room);
  const removable = isRemovableUnsourcedDraft(project.scene, room);

  return (
    <div className="ops-evidence-row-wrap">
      <button
        type="button"
        className="ops-evidence-row"
        onClick={() => onOpenRoom(room.id)}
      >
        <span>
          <b>{room.name}</b>
          <small>{(room.width * room.depth).toFixed(2)} m²</small>
        </span>
        <span>
          <b>{floor?.name ?? "Unknown floor"}</b>
          <small>{room.unit}</small>
        </span>
        <span>
          {room.width.toFixed(2)} × {room.depth.toFixed(2)} ×{" "}
          {room.height.toFixed(2)} m
        </span>
        <span>
          <b>{evidence.label}</b>
          <small>{evidence.detail}</small>
        </span>
        <span
          className={
            room.verified
              ? "ops-pill ops-pill--ready"
              : "ops-pill ops-pill--warning"
          }
        >
          {room.verified ? "REVIEWED" : "NEEDS REVIEW"}
        </span>
      </button>
      {removable && (
        <button
          type="button"
          className="ops-remove-draft"
          onClick={() => onRemoveDraft(room.id)}
        >
          Remove unsourced draft
        </button>
      )}
    </div>
  );
}

export default function StudioEvidence({
  project,
  readiness,
  onOpenRoom,
  onRemoveDraft,
}: {
  project: Project;
  readiness: StudioReadiness;
  onOpenRoom: (roomId: string) => void;
  onRemoveDraft: (roomId: string) => void;
}) {
  const openRooms = project.scene.rooms.filter((room) => !room.verified);
  const reviewedRooms = project.scene.rooms.filter((room) => room.verified);
  const attentionItems = readiness.items.filter(
    (item) => item.severity !== "ready" && item.id !== "evidence",
  );

  return (
    <section className="studio-ops-view" aria-label="Needs attention review">
      <div className="ops-title-row">
        <div>
          <span className="ops-eyebrow">REVIEW</span>
          <h2>Needs attention</h2>
          <p>
            Only unresolved work is shown first. Reviewed rooms and technical
            provenance remain available below without crowding the operator flow.
          </p>
        </div>
        <div className="ops-title-actions">
          <span className="ops-pill ops-pill--ready">
            {readiness.reviewedRooms} REVIEWED
          </span>
          <span className="ops-pill ops-pill--warning">
            {openRooms.length} OPEN
          </span>
        </div>
      </div>

      {attentionItems.length > 0 && (
        <article className="ops-card ops-attention-summary">
          {attentionItems.map((item) => (
            <div
              key={item.id}
              className={`ops-attention-item ops-attention-item--${item.severity}`}
            >
              <b>{item.title}</b>
              <small>{item.detail}</small>
            </div>
          ))}
        </article>
      )}

      <article className="ops-card">
        <div className="ops-card-head">
          <div>
            <span className="ops-eyebrow">ROOM REVIEW</span>
            <h3>{openRooms.length ? "Unresolved rooms" : "Rooms complete"}</h3>
          </div>
          <small>
            {openRooms.length
              ? `${openRooms.length} room${openRooms.length === 1 ? "" : "s"} need attention`
              : "All authored rooms are reviewed"}
          </small>
        </div>

        {!openRooms.length ? (
          <div className="ops-empty">
            <b>No room review remaining</b>
            <p>
              Room evidence is complete. Continue with any opening, cloud or
              publish warnings shown above.
            </p>
          </div>
        ) : (
          <div className="ops-evidence-table">
            <div className="ops-evidence-head">
              <span>Room</span>
              <span>Floor / Unit</span>
              <span>Dimensions</span>
              <span>Evidence</span>
              <span>Status</span>
            </div>
            {openRooms.map((room) => (
              <EvidenceRow
                key={room.id}
                project={project}
                room={room}
                onOpenRoom={onOpenRoom}
                onRemoveDraft={onRemoveDraft}
              />
            ))}
          </div>
        )}
      </article>

      {reviewedRooms.length > 0 && (
        <details className="ops-reviewed-details">
          <summary>Reviewed rooms · {reviewedRooms.length}</summary>
          <article className="ops-card">
            <div className="ops-evidence-table">
              <div className="ops-evidence-head">
                <span>Room</span>
                <span>Floor / Unit</span>
                <span>Dimensions</span>
                <span>Evidence</span>
                <span>Status</span>
              </div>
              {reviewedRooms.map((room) => (
                <EvidenceRow
                  key={room.id}
                  project={project}
                  room={room}
                  onOpenRoom={onOpenRoom}
                  onRemoveDraft={onRemoveDraft}
                />
              ))}
            </div>
          </article>
        </details>
      )}
    </section>
  );
}

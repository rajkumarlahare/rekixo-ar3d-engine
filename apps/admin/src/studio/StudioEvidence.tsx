import type { Project } from "./domain";
import type { StudioReadiness } from "./readiness";

export default function StudioEvidence({
  project,
  readiness,
  onOpenRoom,
}: {
  project: Project;
  readiness: StudioReadiness;
  onOpenRoom: (roomId: string) => void;
}) {
  return (
    <section className="studio-ops-view" aria-label="Evidence review">
      <div className="ops-title-row">
        <div>
          <span className="ops-eyebrow">EVIDENCE REVIEW</span>
          <h2>Measurement provenance</h2>
          <p>
            Reviewed status stays explicit. Missing, reconstructed or unresolved
            evidence remains visible instead of becoming silent dimensional truth.
          </p>
        </div>
        <div className="ops-title-actions">
          <span className="ops-pill ops-pill--ready">
            {readiness.reviewedRooms} REVIEWED
          </span>
          <span className="ops-pill ops-pill--warning">
            {readiness.totalRooms - readiness.reviewedRooms} OPEN
          </span>
        </div>
      </div>

      <article className="ops-card">
        <div className="ops-evidence-table">
          <div className="ops-evidence-head">
            <span>Room</span>
            <span>Floor / Unit</span>
            <span>Dimensions</span>
            <span>Evidence</span>
            <span>Status</span>
          </div>
          {!project.scene.rooms.length ? (
            <div className="ops-empty">
              <b>No authored rooms</b>
              <p>
                Exterior-only projects do not require room evidence. Add rooms in
                the 3D Editor when measured interior geometry is available.
              </p>
            </div>
          ) : (
            project.scene.rooms.map((room) => {
              const floor = project.scene.floors.find(
                (candidate) => candidate.id === room.floorId,
              );
              const evidenceLabel = room.sourcePackSourceId
                ? room.sourcePackSourceId
                : room.sourceAssetId
                  ? "Attached project asset"
                  : room.source.trim()
                    ? "Source note"
                    : "No source";
              const evidenceDetail = room.sourceClaimIds?.length
                ? `${room.sourceClaimIds.length} source claim(s)`
                : room.source.trim()
                  ? room.source.slice(0, 100)
                  : "Open room properties to add provenance";

              return (
                <button
                  key={room.id}
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
                    <b>{evidenceLabel}</b>
                    <small>{evidenceDetail}</small>
                  </span>
                  <span
                    className={
                      room.verified
                        ? "ops-pill ops-pill--ready"
                        : "ops-pill ops-pill--warning"
                    }
                  >
                    {room.verified ? "REVIEWED" : "UNVERIFIED"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </article>
    </section>
  );
}

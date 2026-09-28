import type { Project } from "./domain";
import type { StudioReadiness } from "./readiness";

export default function StudioOverview({
  project,
  dirty,
  readiness,
  unitCount,
  onOpenEditor,
  onOpenSources,
  onOpenEvidence,
  onOpenPublish,
}: {
  project: Project;
  dirty: boolean;
  readiness: StudioReadiness;
  unitCount: number;
  onOpenEditor: () => void;
  onOpenSources: () => void;
  onOpenEvidence: () => void;
  onOpenPublish: () => void;
}) {
  const steps = [
    ["1", "Sources", "Import model, drawings and references", onOpenSources],
    ["2", "Author", "Floors, units, rooms and placement", onOpenEditor],
    ["3", "Evidence", "Review measurement provenance", onOpenEvidence],
    ["4", "Release", "Preview, readiness, publish and rollback", onOpenPublish],
  ] as const;

  return (
    <section className="studio-ops-view" aria-label="Project overview">
      <div className="ops-title-row">
        <div>
          <span className="ops-eyebrow">PROJECT OPERATIONS</span>
          <h2>{project.name}</h2>
          <p>
            One selected project, one cloud draft and one explicitly activated
            immutable customer release.
          </p>
        </div>
        <button onClick={onOpenEditor}>Open 3D editor</button>
      </div>

      <div className="ops-stat-grid">
        <article>
          <span>DRAFT</span>
          <strong>
            {dirty
              ? "Unsaved"
              : project.cloud
                ? `Cloud r${project.cloud.revision}`
                : "Local only"}
          </strong>
          <small>Authoring state</small>
        </article>
        <article>
          <span>MODEL</span>
          <strong>{readiness.modelAsset ? "Loaded" : "Not loaded"}</strong>
          <small>{readiness.modelAsset?.name ?? "No active model"}</small>
        </article>
        <article>
          <span>STRUCTURE</span>
          <strong>
            {project.scene.floors.length}F · {unitCount}U ·{" "}
            {project.scene.rooms.length}R
          </strong>
          <small>{project.scene.furniture.length} furniture objects</small>
        </article>
        <article>
          <span>EVIDENCE</span>
          <strong>
            {readiness.reviewedRooms}/{readiness.totalRooms}
          </strong>
          <small>{readiness.referenceAssets} source/reference assets</small>
        </article>
        <article>
          <span>PUBLIC</span>
          <strong>
            {readiness.activeRelease
              ? `Release v${readiness.activeRelease.version}`
              : "Not released"}
          </strong>
          <small>Immutable active release</small>
        </article>
        <article>
          <span>READINESS</span>
          <strong>{readiness.score}%</strong>
          <small>
            {readiness.blockers.length
              ? `${readiness.blockers.length} blocker(s)`
              : readiness.warnings.length
                ? `${readiness.warnings.length} warning(s)`
                : "Ready for publish"}
          </small>
        </article>
      </div>

      <div className="ops-grid ops-grid--overview">
        <article className="ops-card">
          <div className="ops-card-head">
            <div>
              <span className="ops-eyebrow">WORKFLOW</span>
              <h3>Production path</h3>
            </div>
          </div>
          <div className="ops-workflow">
            {steps.map(([number, title, detail, action]) => (
              <button key={number} onClick={action}>
                <b>{number}</b>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
                <i>→</i>
              </button>
            ))}
          </div>
        </article>

        <article className="ops-card">
          <div className="ops-card-head">
            <div>
              <span className="ops-eyebrow">HEALTH</span>
              <h3>Publish readiness</h3>
            </div>
            <button onClick={onOpenPublish}>Open release</button>
          </div>
          <div className="ops-health-list">
            {readiness.items.map((item) => (
              <div
                className={`ops-health ops-health--${item.severity}`}
                key={item.id}
              >
                <span>
                  {item.severity === "ready"
                    ? "✓"
                    : item.severity === "warning"
                      ? "!"
                      : "×"}
                </span>
                <div>
                  <b>{item.title}</b>
                  <small>{item.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

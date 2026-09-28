import type {
  CloudReleaseSummary,
  CloudSession,
} from "./cloud";
import type { Project } from "./domain";
import {
  publicProjectUrl,
  publishedShowcaseUrl,
  type StudioReadiness,
} from "./readiness";

export default function StudioPublish({
  project,
  readiness,
  session,
  releases,
  published,
  busy,
  dirty,
  onSaveLocal,
  onSaveCloud,
  onPublish,
  onActivate,
  onCreateReview,
}: {
  project: Project;
  readiness: StudioReadiness;
  session?: CloudSession;
  releases: CloudReleaseSummary[];
  published: boolean;
  busy: boolean;
  dirty: boolean;
  onSaveLocal: () => void;
  onSaveCloud: () => void;
  onPublish: () => void;
  onActivate: (releaseId: string, version: number) => void;
  onCreateReview: () => void;
}) {
  return (
    <section className="studio-ops-view" aria-label="Preview and publish">
      <div className="ops-title-row">
        <div>
          <span className="ops-eyebrow">PREVIEW & RELEASE</span>
          <h2>Customer publication</h2>
          <p>
            Save the exact cloud draft first, inspect readiness, then create an
            immutable release. Rollback only switches the active release pointer.
          </p>
        </div>
        <div className="ops-title-actions">
          <button disabled={busy} onClick={onSaveLocal}>
            Save local
          </button>
          <button
            disabled={busy || !session?.authenticated}
            onClick={onSaveCloud}
          >
            Save to cloud
          </button>
        </div>
      </div>

      <div className="ops-grid ops-grid--publish">
        <article className="ops-card">
          <div className="ops-card-head">
            <div>
              <span className="ops-eyebrow">READINESS</span>
              <h3>
                {readiness.publishable
                  ? "Ready to publish"
                  : `${readiness.blockers.length} blocker(s)`}
              </h3>
            </div>
            <span
              className={
                readiness.publishable
                  ? "ops-pill ops-pill--ready"
                  : "ops-pill ops-pill--blocker"
              }
            >
              {readiness.score}%
            </span>
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

          <div className="ops-publish-actions">
            <button
              className="ops-primary"
              disabled={busy || !readiness.publishable}
              onClick={onPublish}
            >
              Publish immutable release
            </button>
            <button disabled={busy} onClick={onCreateReview}>
              Create local review version
            </button>
          </div>
        </article>

        <article className="ops-card">
          <div className="ops-card-head">
            <div>
              <span className="ops-eyebrow">PREVIEW</span>
              <h3>Customer-facing checks</h3>
            </div>
          </div>
          <div className="ops-preview-links">
            <a
              href={publicProjectUrl(project)}
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <b>Public runtime</b>
                <small>Current customer URL</small>
              </span>
              <i>↗</i>
            </a>
            <a
              href={publishedShowcaseUrl(project)}
              target="_blank"
              rel="noreferrer"
              className={published ? "" : "disabled"}
              aria-disabled={!published}
              onClick={(event) => {
                if (!published) event.preventDefault();
              }}
            >
              <span>
                <b>Published Studio showcase</b>
                <small>
                  {published
                    ? "Active release / compatibility snapshot"
                    : "No published Studio snapshot yet"}
                </small>
              </span>
              <i>↗</i>
            </a>
          </div>
        </article>

        <article className="ops-card ops-card--releases">
          <div className="ops-card-head">
            <div>
              <span className="ops-eyebrow">RELEASE HISTORY</span>
              <h3>{releases.length} immutable releases</h3>
            </div>
          </div>
          <div className="ops-release-list">
            {!releases.length ? (
              <div className="ops-empty">
                <b>No release history</b>
                <p>
                  The first publish freezes the selected cloud revision and its
                  referenced assets.
                </p>
              </div>
            ) : (
              releases.map((release) => (
                <div
                  className={
                    release.active
                      ? "ops-release ops-release--active"
                      : "ops-release"
                  }
                  key={release.id}
                >
                  <span className="ops-release-version">
                    v{release.version}
                  </span>
                  <span>
                    <b>
                      {release.active
                        ? "Active public release"
                        : release.sourceDraftRevision
                          ? `Cloud draft r${release.sourceDraftRevision}`
                          : "Frozen legacy runtime"}
                    </b>
                    <small>
                      {new Date(release.createdAt).toLocaleString()} ·{" "}
                      {release.manifestSha256.slice(0, 12)}…
                    </small>
                  </span>
                  {release.active ? (
                    <strong>LIVE</strong>
                  ) : (
                    <button
                      disabled={busy || dirty}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Switch the public project to immutable release v${release.version}? The current draft will not be changed.`,
                          )
                        )
                          return;
                        onActivate(release.id, release.version);
                      }}
                    >
                      Activate v{release.version}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

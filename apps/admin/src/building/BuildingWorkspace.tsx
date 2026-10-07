import { useEffect, useMemo, useState } from "react";
import { publicProjectPath } from "@rekixo/3d-engine-core";
import {
  experiences,
  projects,
  releases,
  type CloudProjectSummary,
  type CloudReleaseSummary,
} from "../studio/cloud";
import "./building-workspace.css";

function selectedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

export default function BuildingWorkspace() {
  const slug = selectedProjectSlug();
  const [project, setProject] = useState<CloudProjectSummary>();
  const [releaseItems, setReleaseItems] = useState<CloudReleaseSummary[]>([]);
  const [hasGeo, setHasGeo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setError("Project select karke Building workspace open karein.");
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    void Promise.all([projects("", "active", 100, 0), releases(slug), experiences(slug)])
      .then(([projectResult, releaseResult, experienceResult]) => {
        if (!live) return;
        setProject(projectResult.projects.find((item) => item.slug === slug));
        setReleaseItems(releaseResult.releases);
        setHasGeo(experienceResult.experiences.some((item) => item.type === "geo"));
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Building state load nahi hua.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [slug]);

  const activeRelease = useMemo(() => releaseItems.find((item) => item.active), [releaseItems]);
  const buildingLive = Boolean(project?.status === "published" && activeRelease);

  return (
    <div className="building-workspace">
      {error ? <div className="building-workspace__alert">{error}</div> : null}

      <section className="building-workspace__hero engine-control-card">
        <div>
          <p>BUILDING CONTROL CENTER</p>
          <h2>{project?.name || (loading ? "Loading Building workspace…" : "3D Building")}</h2>
          <span>
            {activeRelease
              ? `Active immutable Building release v${activeRelease.version}.`
              : "Source → review → immutable Building release workflow."}
          </span>
        </div>
        <div className="building-workspace__hero-status">
          <span className={buildingLive ? "building-workspace__badge building-workspace__badge--live" : "building-workspace__badge"}>
            {buildingLive ? "BUILDING LIVE" : activeRelease ? "RELEASE READY" : "IN PROGRESS"}
          </span>
          {buildingLive ? (
            <a className="engine-control-link" href={publicProjectPath(slug)} target="_blank" rel="noreferrer">Open Building Site</a>
          ) : null}
        </div>
      </section>

      <section className="building-workspace__flow" aria-label="Building workflow">
        <article className="engine-control-card">
          <div className="building-workspace__step">01</div>
          <div>
            <p>SOURCE & BUILD</p>
            <h3>Prepare canonical Building</h3>
            <span>Verified originals, geometry authority, scale review and durable processing stay together in Source Pack.</span>
          </div>
          <a href={`/3Dprojects/source-pack?project=${encodeURIComponent(slug)}`}>Open Source Pack</a>
        </article>

        <article className="engine-control-card">
          <div className="building-workspace__step">02</div>
          <div>
            <p>REVIEW</p>
            <h3>Review canonical components</h3>
            <span>Bind verified model nodes to floor, unit, room and semantic identities without changing source geometry.</span>
          </div>
          <a href={`/3Dprojects/component-mapper?project=${encodeURIComponent(slug)}`}>Open Component Review</a>
        </article>

        <article className="engine-control-card">
          <div className="building-workspace__step">03</div>
          <div>
            <p>PRESENTATION</p>
            <h3>Check customer-facing Building</h3>
            <span>Use the current immutable Building output as the customer-facing truth. Live site remains independent from optional Geo.</span>
          </div>
          {buildingLive ? (
            <a href={publicProjectPath(slug)} target="_blank" rel="noreferrer">Open Presentation</a>
          ) : (
            <a href={`/3Dprojects/source-pack?project=${encodeURIComponent(slug)}`}>Continue Building Setup</a>
          )}
        </article>

        <article className="engine-control-card">
          <div className="building-workspace__step">04</div>
          <div>
            <p>PUBLISH</p>
            <h3>Immutable Building release</h3>
            <span>Release activation, history and live identity are managed centrally so operators do not hunt across screens.</span>
          </div>
          <a href={`/3Dprojects/releases?project=${encodeURIComponent(slug)}`}>Open Building Releases</a>
        </article>
      </section>

      <section className="building-workspace__summary engine-control-card">
        <div>
          <p>CURRENT STATE</p>
          <h3>Building release summary</h3>
        </div>
        <dl>
          <div><dt>Project</dt><dd>{project?.status?.toUpperCase() || "—"}</dd></div>
          <div><dt>Active Building</dt><dd>{activeRelease ? `v${activeRelease.version}` : "Not published"}</dd></div>
          <div><dt>Release history</dt><dd>{releaseItems.length}</dd></div>
          <div><dt>Geo add-on</dt><dd>{hasGeo ? "Added" : "Optional / not added"}</dd></div>
        </dl>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { geoPublicProjectPath, publicProjectPath } from "@rekixo/3d-engine-core";
import {
  activateGeoRelease,
  activateRelease,
  geoReleases,
  releases,
  type CloudGeoReleaseState,
  type CloudReleaseSummary,
} from "../studio/cloud";
import "./engine-releases.css";

function selectedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function EngineReleases() {
  const slug = selectedProjectSlug();
  const [building, setBuilding] = useState<CloudReleaseSummary[]>([]);
  const [geo, setGeo] = useState<CloudGeoReleaseState>();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    if (!slug) {
      setError("Project select karke Releases open karein.");
      return;
    }
    setError("");
    const [buildingResult, geoResult] = await Promise.all([
      releases(slug),
      geoReleases(slug).catch(() => ({
        schemaReady: true,
        experienceId: null,
        draftRevision: null,
        previewVerified: false,
        previewVerification: null,
        activeRelease: null,
        releases: [],
      } as CloudGeoReleaseState)),
    ]);
    setBuilding(buildingResult.releases);
    setGeo(geoResult);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Release history load nahi hui."));
  }, [slug]);

  async function activateBuilding(id: string) {
    setBusy(`building:${id}`);
    setMessage("");
    setError("");
    try {
      await activateRelease(slug, id);
      await load();
      setMessage("Selected immutable Building release activated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Building release activate nahi hua.");
    } finally {
      setBusy("");
    }
  }

  async function activateGeo(id: string) {
    setBusy(`geo:${id}`);
    setMessage("");
    setError("");
    try {
      await activateGeoRelease(slug, id);
      await load();
      setMessage("Selected immutable Geo release activated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Geo release activate nahi hua.");
    } finally {
      setBusy("");
    }
  }

  const activeBuilding = building.find((item) => item.active);
  const activeGeo = geo?.activeRelease || null;

  return (
    <div className="engine-releases-page">
      {error ? <div className="engine-release-alert engine-release-alert--error">{error}</div> : null}
      {message ? <div className="engine-release-alert engine-release-alert--ok">{message}</div> : null}

      <section className="engine-release-summary">
        <article className="engine-control-card">
          <span>ACTIVE BUILDING</span>
          <strong>{activeBuilding ? `v${activeBuilding.version}` : "None"}</strong>
          <small>{activeBuilding ? `SHA ${activeBuilding.manifestSha256.slice(0, 14)}…` : "Publish an immutable Building release first."}</small>
          {activeBuilding ? <a href={publicProjectPath(slug)} target="_blank" rel="noreferrer">Open Building Live</a> : null}
        </article>
        <article className="engine-control-card">
          <span>ACTIVE GEO</span>
          <strong>{activeGeo ? `v${activeGeo.version}` : "None"}</strong>
          <small>{activeGeo ? `Building v${activeGeo.sourceBuildingReleaseVersion} · draft r${activeGeo.sourceDraftRevision}` : "Geo remains optional until added and published."}</small>
          {activeGeo ? <a href={geoPublicProjectPath(slug)} target="_blank" rel="noreferrer">Open Geo Live</a> : null}
        </article>
      </section>

      <section className="engine-release-columns">
        <div className="engine-release-panel engine-control-card">
          <header>
            <div>
              <p>BUILDING RELEASES</p>
              <h2>Immutable Building history</h2>
              <span>Exactly one release is active at a time. Historical releases stay immutable.</span>
            </div>
            <b>{building.length}</b>
          </header>
          <div className="engine-release-list">
            {building.map((release) => (
              <article key={release.id} className={release.active ? "engine-release-row engine-release-row--active" : "engine-release-row"}>
                <div>
                  <span>BUILDING v{release.version}</span>
                  <strong>{release.active ? "ACTIVE / LIVE SOURCE" : "IMMUTABLE"}</strong>
                  <small>{formatDate(release.createdAt)} · SHA {release.manifestSha256.slice(0, 14)}…</small>
                </div>
                {release.active ? (
                  <span className="engine-release-live-dot">LIVE</span>
                ) : (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void activateBuilding(release.id)}>
                    {busy === `building:${release.id}` ? "Activating…" : "Activate"}
                  </button>
                )}
              </article>
            ))}
            {!building.length ? <div className="engine-release-empty">No immutable Building releases yet.</div> : null}
          </div>
        </div>

        <div className="engine-release-panel engine-control-card">
          <header>
            <div>
              <p>GEO RELEASES</p>
              <h2>Immutable Geo history</h2>
              <span>Each Geo release is pinned to an immutable Building release and verified draft revision.</span>
            </div>
            <b>{geo?.releases.length || 0}</b>
          </header>
          <div className="engine-release-list">
            {geo?.releases.map((release) => (
              <article key={release.id} className={release.active ? "engine-release-row engine-release-row--active" : "engine-release-row"}>
                <div>
                  <span>GEO v{release.version}</span>
                  <strong>{release.active ? "ACTIVE / LIVE" : `BUILDING v${release.sourceBuildingReleaseVersion}`}</strong>
                  <small>{formatDate(release.createdAt)} · draft r{release.sourceDraftRevision} · SHA {release.manifestSha256.slice(0, 12)}…</small>
                </div>
                {release.active ? (
                  <span className="engine-release-live-dot">LIVE</span>
                ) : (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void activateGeo(release.id)}>
                    {busy === `geo:${release.id}` ? "Activating…" : "Activate"}
                  </button>
                )}
              </article>
            ))}
            {!geo?.releases.length ? <div className="engine-release-empty">No immutable Geo releases yet.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

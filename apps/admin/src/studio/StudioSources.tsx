import type { Asset, Project } from "./domain";
import { studioAssetKind, type StudioReadiness } from "./readiness";

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

export default function StudioSources({
  project,
  files,
  readiness,
  busy,
  onImportModel,
  onImportReference,
  onDownload,
}: {
  project: Project;
  files: Asset[];
  readiness: StudioReadiness;
  busy: boolean;
  onImportModel: () => void;
  onImportReference: () => void;
  onDownload: (asset: Asset) => void;
}) {
  const sources = files.filter((asset) => asset.id !== project.scene.modelId);
  const model = readiness.modelAsset;
  const glbReady = Boolean(model?.name.toLowerCase().endsWith(".glb"));

  return (
    <section className="studio-ops-view" aria-label="Source intake">
      <div className="ops-title-row">
        <div>
          <span className="ops-eyebrow">SOURCE INTAKE</span>
          <h2>Model & evidence assets</h2>
          <p>
            Keep source files, visual references and the web-ready model inside
            the selected project boundary.
          </p>
        </div>
        <div className="ops-title-actions">
          <button disabled={busy} onClick={onImportModel}>
            Import model
          </button>
          <button disabled={busy} onClick={onImportReference}>
            Add source/reference
          </button>
        </div>
      </div>

      <div className="ops-grid ops-grid--sources">
        <article className="ops-card">
          <div className="ops-card-head">
            <div>
              <span className="ops-eyebrow">PUBLISH MODEL</span>
              <h3>{model?.name ?? "No model selected"}</h3>
            </div>
            {model && (
              <span
                className={
                  glbReady
                    ? "ops-pill ops-pill--ready"
                    : "ops-pill ops-pill--warning"
                }
              >
                {glbReady ? "WEB READY" : "SOURCE MODEL"}
              </span>
            )}
          </div>

          {model ? (
            <div className="ops-file-detail">
              <dl>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(model.size)}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{model.type || "application/octet-stream"}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>{model.hash}</dd>
                </div>
                <div>
                  <dt>Runtime status</dt>
                  <dd>
                    {glbReady
                      ? "Self-contained GLB is eligible for customer release."
                      : "FBX is for Studio inspection; convert to self-contained GLB before release."}
                  </dd>
                </div>
              </dl>
              <button onClick={() => onDownload(model)}>
                Download source copy
              </button>
            </div>
          ) : (
            <div className="ops-empty">
              <b>No 3D model imported</b>
              <p>
                You can still author measured rooms, but the final customer 3D
                model should be a self-contained GLB.
              </p>
            </div>
          )}
        </article>

        <article className="ops-card">
          <div className="ops-card-head">
            <div>
              <span className="ops-eyebrow">SOURCE LIBRARY</span>
              <h3>{sources.length} attached files</h3>
            </div>
          </div>
          <div className="ops-source-list">
            {!sources.length ? (
              <div className="ops-empty">
                <b>No source evidence attached</b>
                <p>
                  Add DWG/DXF/PDF/SKP/SKB/DRS/images/CSV when they support
                  dimensions, geometry, materials or visual intent.
                </p>
              </div>
            ) : (
              sources.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => onDownload(asset)}
                  title={asset.hash}
                >
                  <span className="ops-file-type">
                    {studioAssetKind(asset).toUpperCase()}
                  </span>
                  <span>
                    <b>{asset.name}</b>
                    <small>
                      {formatBytes(asset.size)} · {asset.hash.slice(0, 12)}…
                    </small>
                  </span>
                  <i>↧</i>
                </button>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

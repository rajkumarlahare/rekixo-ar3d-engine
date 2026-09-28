import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  id,
  type Asset,
  type ModelTransform,
  type ReferenceLayer,
} from "./domain";

interface Props {
  files: Asset[];
  modelId?: string;
  layers: ReferenceLayer[];
  modelTransform: ModelTransform;
  disabled?: boolean;
  onUpsertLayer: (layer: ReferenceLayer) => void;
  onRemoveLayer: (id: string) => void;
  onModelTransform: (change: Partial<ModelTransform>) => void;
  onTopView: () => void;
  onClose: () => void;
}

type Point = { x: number; y: number };

function extension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

function sourceKind(asset?: Asset) {
  if (!asset) return "other";
  if (asset.type.startsWith("image/") || /\.(png|jpe?g|webp|tiff?)$/i.test(asset.name))
    return "image";
  if (asset.type === "application/pdf" || /\.pdf$/i.test(asset.name))
    return "pdf";
  if (/\.(dwg|dxf)$/i.test(asset.name)) return "cad";
  return "other";
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function ReferenceWorkspace({
  files,
  modelId,
  layers,
  modelTransform,
  disabled,
  onUpsertLayer,
  onRemoveLayer,
  onModelTransform,
  onTopView,
  onClose,
}: Props) {
  const candidates = useMemo(
    () =>
      files.filter(
        (file) =>
          file.id !== modelId &&
          ["image", "pdf", "cad"].includes(sourceKind(file)),
      ),
    [files, modelId],
  );
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [points, setPoints] = useState<Point[]>([]);
  const [knownDistance, setKnownDistance] = useState("1");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (
      selectedAssetId &&
      candidates.some((candidate) => candidate.id === selectedAssetId)
    )
      return;
    setSelectedAssetId(
      layers.find((layer) =>
        candidates.some((candidate) => candidate.id === layer.assetId),
      )?.assetId ??
        candidates[0]?.id ??
        "",
    );
  }, [candidates, layers, selectedAssetId]);

  useEffect(() => {
    setPoints([]);
    setNaturalSize({ width: 0, height: 0 });
  }, [selectedAssetId]);

  const asset = candidates.find((candidate) => candidate.id === selectedAssetId);
  const layer = layers.find((candidate) => candidate.assetId === selectedAssetId);
  const kind = sourceKind(asset);
  const objectUrl = useMemo(
    () => (asset ? URL.createObjectURL(asset.blob) : ""),
    [asset],
  );

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  function upsert(change: Partial<ReferenceLayer>) {
    if (!asset) return;
    onUpsertLayer({
      id: layer?.id ?? id(),
      assetId: asset.id,
      visible: layer?.visible ?? true,
      opacity: layer?.opacity ?? 0.5,
      metresPerPixel: layer?.metresPerPixel,
      x: layer?.x ?? 0,
      y: layer?.y ?? 0.01,
      z: layer?.z ?? 0,
      rotation: layer?.rotation ?? 0,
      ...change,
    });
  }

  function clickImage(event: MouseEvent<HTMLImageElement>) {
    if (disabled) return;
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const rect = image.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * image.naturalWidth,
      y: ((event.clientY - rect.top) / rect.height) * image.naturalHeight,
    };
    setPoints((current) => (current.length >= 2 ? [point] : [...current, point]));
  }

  function calibrate() {
    if (points.length !== 2 || !asset) return;
    const metres = Number(knownDistance);
    const pixels = Math.hypot(
      points[1].x - points[0].x,
      points[1].y - points[0].y,
    );
    if (!Number.isFinite(metres) || metres <= 0 || pixels <= 0) return;
    upsert({ metresPerPixel: metres / pixels, visible: true });
  }

  const widthM =
    layer?.metresPerPixel && naturalSize.width
      ? layer.metresPerPixel * naturalSize.width
      : undefined;
  const heightM =
    layer?.metresPerPixel && naturalSize.height
      ? layer.metresPerPixel * naturalSize.height
      : undefined;

  return (
    <section className="reference-workspace" aria-label="Reference alignment workspace">
      <header className="reference-workspace-head">
        <div>
          <small>REFERENCE ALIGNMENT</small>
          <strong>Plan calibration & model alignment</strong>
        </div>
        <div>
          <button type="button" onClick={onTopView}>
            Top view
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div className="reference-workspace-grid">
        <aside className="reference-source-list">
          <div className="section-label">SOURCE FILES</div>
          {!candidates.length && (
            <p>
              Attach a JPG/PNG/PDF/DWG source first. Image references can be
              calibrated directly in this workspace.
            </p>
          )}
          {candidates.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className={
                candidate.id === selectedAssetId
                  ? "reference-source active"
                  : "reference-source"
              }
              onClick={() => setSelectedAssetId(candidate.id)}
            >
              <span>{candidate.name}</span>
              <small>
                {extension(candidate.name).toUpperCase()} ·{" "}
                {(candidate.size / 1048576).toFixed(1)} MB
              </small>
            </button>
          ))}
        </aside>

        <div className="reference-preview">
          {!asset ? (
            <div className="reference-empty">Select a reference source.</div>
          ) : kind === "image" ? (
            <div className="reference-image-stage">
              <img
                ref={imageRef}
                src={objectUrl}
                alt={asset.name}
                onLoad={(event) =>
                  setNaturalSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onClick={clickImage}
              />
              {points.map((point, index) => (
                <span
                  className="reference-calibration-point"
                  key={`${point.x}:${point.y}:${index}`}
                  style={{
                    left: `${(point.x / Math.max(naturalSize.width, 1)) * 100}%`,
                    top: `${(point.y / Math.max(naturalSize.height, 1)) * 100}%`,
                  }}
                >
                  {index === 0 ? "A" : "B"}
                </span>
              ))}
            </div>
          ) : kind === "pdf" ? (
            <object
              className="reference-pdf"
              data={objectUrl}
              type="application/pdf"
              aria-label={asset.name}
            >
              <p>PDF preview is unavailable in this browser.</p>
            </object>
          ) : (
            <div className="reference-empty reference-cad-note">
              <b>{asset.name}</b>
              <p>
                The original CAD file stays preserved as dimensional evidence.
                Browser-side DWG/DXF geometry is not guessed or silently
                converted. Export the required plan sheet as PNG/JPG/PDF and
                attach it for visual calibration.
              </p>
            </div>
          )}
        </div>

        <aside className="reference-controls">
          <div className="section-label">CALIBRATION</div>
          {kind === "image" ? (
            <>
              <p>
                Click two points on a known drawing dimension, enter the real
                distance in metres, then calibrate.
              </p>
              <div className="reference-point-status">
                <span>{points[0] ? "A ✓" : "A —"}</span>
                <span>{points[1] ? "B ✓" : "B —"}</span>
              </div>
              <label>
                Known distance (m)
                <input
                  type="number"
                  min="0.001"
                  step="0.01"
                  value={knownDistance}
                  disabled={disabled}
                  onChange={(event) => setKnownDistance(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary"
                disabled={disabled || points.length !== 2}
                onClick={calibrate}
              >
                Calibrate scale
              </button>
              {layer?.metresPerPixel && (
                <div className="reference-calibrated">
                  <b>Calibrated</b>
                  <small>
                    {(layer.metresPerPixel * 1000).toFixed(3)} mm / px
                    {widthM && heightM
                      ? ` · ${widthM.toFixed(2)} × ${heightM.toFixed(2)} m`
                      : ""}
                  </small>
                </div>
              )}
            </>
          ) : (
            <p>
              Direct click calibration is available for image references. Keep
              this source attached and add a raster export for alignment.
            </p>
          )}

          {layer && (
            <>
              <div className="section-label">REFERENCE PLANE</div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  disabled={disabled}
                  onChange={(event) => upsert({ visible: event.target.checked })}
                />
                Show in 3D viewport
              </label>
              <label>
                Opacity
                <input
                  type="number"
                  min="0.02"
                  max="1"
                  step="0.05"
                  value={layer.opacity}
                  disabled={disabled}
                  onChange={(event) =>
                    upsert({
                      opacity: Math.min(
                        1,
                        Math.max(0.02, numberValue(event.target.value, layer.opacity)),
                      ),
                    })
                  }
                />
              </label>
              <div className="reference-number-grid">
                <label>
                  X (m)
                  <input
                    type="number"
                    step="0.1"
                    value={layer.x}
                    disabled={disabled}
                    onChange={(event) =>
                      upsert({ x: numberValue(event.target.value, layer.x) })
                    }
                  />
                </label>
                <label>
                  Z (m)
                  <input
                    type="number"
                    step="0.1"
                    value={layer.z}
                    disabled={disabled}
                    onChange={(event) =>
                      upsert({ z: numberValue(event.target.value, layer.z) })
                    }
                  />
                </label>
                <label>
                  Elevation Y
                  <input
                    type="number"
                    step="0.01"
                    value={layer.y}
                    disabled={disabled}
                    onChange={(event) =>
                      upsert({ y: numberValue(event.target.value, layer.y) })
                    }
                  />
                </label>
                <label>
                  Rotation °
                  <input
                    type="number"
                    step="1"
                    value={layer.rotation}
                    disabled={disabled}
                    onChange={(event) =>
                      upsert({
                        rotation: numberValue(event.target.value, layer.rotation),
                      })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="danger"
                disabled={disabled}
                onClick={() => onRemoveLayer(layer.id)}
              >
                Remove reference plane
              </button>
            </>
          )}

          <div className="section-label">MODEL ALIGNMENT</div>
          <p>
            Align the imported building to the calibrated plan. This changes the
            project transform only; source model bytes remain untouched.
          </p>
          <div className="reference-number-grid">
            <label>
              Model X
              <input
                type="number"
                step="0.1"
                value={modelTransform.x}
                disabled={disabled}
                onChange={(event) =>
                  onModelTransform({
                    x: numberValue(event.target.value, modelTransform.x),
                  })
                }
              />
            </label>
            <label>
              Model Z
              <input
                type="number"
                step="0.1"
                value={modelTransform.z}
                disabled={disabled}
                onChange={(event) =>
                  onModelTransform({
                    z: numberValue(event.target.value, modelTransform.z),
                  })
                }
              />
            </label>
            <label>
              Model Y
              <input
                type="number"
                step="0.01"
                value={modelTransform.y}
                disabled={disabled}
                onChange={(event) =>
                  onModelTransform({
                    y: numberValue(event.target.value, modelTransform.y),
                  })
                }
              />
            </label>
            <label>
              Rotation Y °
              <input
                type="number"
                step="1"
                value={modelTransform.rotationY}
                disabled={disabled}
                onChange={(event) =>
                  onModelTransform({
                    rotationY: numberValue(
                      event.target.value,
                      modelTransform.rotationY,
                    ),
                  })
                }
              />
            </label>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onModelTransform({ x: 0, y: 0, z: 0, rotationY: 0 })
            }
          >
            Reset model alignment
          </button>
        </aside>
      </div>
    </section>
  );
}

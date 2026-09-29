import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  id,
  type Asset,
  type ModelTransform,
  type ReferenceLayer,
} from "./domain";
import type { TransformMode } from "./SceneCanvas";
import type { QuickSourceSetup } from "./sourcePackSetup";
import {
  rasterPdfReference,
  type PdfReferenceRasterOptions,
} from "./pdfReferenceRaster";

interface Props {
  files: Asset[];
  modelId?: string;
  layers: ReferenceLayer[];
  modelTransform: ModelTransform;
  quickSetup?: QuickSourceSetup;
  transformMode: TransformMode;
  snap: boolean;
  disabled?: boolean;
  onUpsertLayer: (layer: ReferenceLayer) => void;
  onRemoveLayer: (id: string) => void;
  onModelTransform: (change: Partial<ModelTransform>) => void;
  onTransformMode: (mode: "translate" | "rotate") => void;
  onSnap: (value: boolean) => void;
  onCreatePdfReference: (
    source: Asset,
    file: File,
    options: PdfReferenceRasterOptions,
  ) => Promise<Asset>;
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
  quickSetup,
  transformMode,
  snap,
  disabled,
  onUpsertLayer,
  onRemoveLayer,
  onModelTransform,
  onTransformMode,
  onSnap,
  onCreatePdfReference,
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
  const presetAssetId = quickSetup?.alignment
    ? quickSetup.slots.find(
        (slot) => slot.key === quickSetup.alignment?.slotKey,
      )?.asset?.id
    : undefined;
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [points, setPoints] = useState<Point[]>([]);
  const [knownDistance, setKnownDistance] = useState("1");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [pdfPage, setPdfPage] = useState(quickSetup?.alignment?.page ?? 1);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
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
        (presetAssetId &&
        candidates.some((candidate) => candidate.id === presetAssetId)
          ? presetAssetId
          : candidates[0]?.id) ??
        "",
    );
  }, [candidates, layers, presetAssetId, selectedAssetId]);

  useEffect(() => {
    setPoints([]);
    setNaturalSize({ width: 0, height: 0 });
    setPdfError("");
  }, [selectedAssetId]);

  useEffect(() => {
    if (quickSetup?.alignment?.page)
      setPdfPage(quickSetup.alignment.page);
  }, [quickSetup?.alignment?.page]);

  const asset = candidates.find((candidate) => candidate.id === selectedAssetId);
  const layer = layers.find((candidate) => candidate.assetId === selectedAssetId);
  const kind = sourceKind(asset);
  const isPresetSource = Boolean(
    asset && presetAssetId && asset.id === presetAssetId,
  );
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
      opacity: layer?.opacity ?? 0.46,
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
    onTopView();
    onTransformMode("translate");
  }

  async function preparePdfReference() {
    if (!asset || kind !== "pdf") return;
    setPreparingPdf(true);
    setPdfError("");
    try {
      const options: PdfReferenceRasterOptions = {
        page: pdfPage,
        ...(isPresetSource && quickSetup?.alignment?.crop
          ? { crop: quickSetup.alignment.crop }
          : {}),
        ...(isPresetSource && quickSetup?.alignment?.label
          ? { label: quickSetup.alignment.label }
          : { label: "alignment-plan" }),
      };
      const file = await rasterPdfReference(asset, options);
      const derived = await onCreatePdfReference(asset, file, options);
      setSelectedAssetId(derived.id);
      setPoints([]);
      onTopView();
      onTransformMode("translate");
    } catch (reason) {
      setPdfError(
        reason instanceof Error
          ? reason.message
          : "Could not prepare this PDF page for visual alignment.",
      );
    } finally {
      setPreparingPdf(false);
    }
  }

  const widthM =
    layer?.metresPerPixel && naturalSize.width
      ? layer.metresPerPixel * naturalSize.width
      : undefined;
  const heightM =
    layer?.metresPerPixel && naturalSize.height
      ? layer.metresPerPixel * naturalSize.height
      : undefined;
  const planReady = Boolean(layer?.metresPerPixel);

  return (
    <section className="reference-workspace" aria-label="Reference alignment workspace">
      <header className="reference-workspace-head">
        <div>
          <small>VISUAL PLAN ALIGNMENT</small>
          <strong>Plan नीचे रखें, building mouse से align करें</strong>
        </div>
        <div>
          <button type="button" onClick={onTopView}>
            Top view
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </header>

      <div className="reference-quickbar" role="group" aria-label="Visual alignment tools">
        <span className={planReady ? "ready" : ""}>
          <b>1</b> {planReady ? "Plan calibrated" : "Prepare & calibrate plan"}
        </span>
        <span className={planReady ? "active" : ""}>
          <b>2</b> Move / rotate model
        </span>
        <button
          type="button"
          className={transformMode === "translate" ? "active" : ""}
          disabled={disabled || !modelId}
          onClick={() => {
            onTopView();
            onTransformMode("translate");
          }}
        >
          ↔ Move model
        </button>
        <button
          type="button"
          className={transformMode === "rotate" ? "active" : ""}
          disabled={disabled || !modelId}
          onClick={() => {
            onTopView();
            onTransformMode("rotate");
          }}
        >
          ↻ Rotate model
        </button>
        <label className="reference-snap">
          <input
            type="checkbox"
            checked={snap}
            disabled={disabled}
            onChange={(event) => onSnap(event.target.checked)}
          />
          Snap
        </label>
        <button
          type="button"
          disabled={disabled || !layer || !modelId}
          title="Move the model origin to the selected plan centre"
          onClick={() =>
            onModelTransform({
              x: layer?.x ?? 0,
              z: layer?.z ?? 0,
            })
          }
        >
          Center on plan
        </button>
        <button
          type="button"
          disabled={disabled || !modelId}
          onClick={() =>
            onModelTransform({ x: 0, y: 0, z: 0, rotationY: 0 })
          }
        >
          Reset model
        </button>
      </div>

      <div className="reference-workspace-grid">
        <aside className="reference-source-list">
          <div className="section-label">PLAN / REFERENCE</div>
          {!candidates.length && (
            <p>
              Attach a brochure PDF or plan image first. Rekixo keeps the original
              source unchanged.
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
            <div className="reference-empty">Select a plan/reference source.</div>
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
            <div className="reference-pdf-stage">
              <object
                className="reference-pdf"
                data={objectUrl}
                type="application/pdf"
                aria-label={asset.name}
              >
                <p>PDF preview is unavailable in this browser.</p>
              </object>
              <div className="reference-pdf-action">
                <label>
                  Page
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pdfPage}
                    disabled={disabled || preparingPdf}
                    onChange={(event) =>
                      setPdfPage(Math.max(1, Math.round(numberValue(event.target.value, 1))))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={disabled || preparingPdf}
                  onClick={() => void preparePdfReference()}
                >
                  {preparingPdf
                    ? "Preparing plan…"
                    : isPresetSource
                      ? "Use detected floor plan"
                      : "Use this PDF page"}
                </button>
                {isPresetSource && quickSetup?.alignment?.crop && (
                  <small>Project preset will crop the useful plan area automatically.</small>
                )}
                {pdfError && <small className="error">{pdfError}</small>}
              </div>
            </div>
          ) : (
            <div className="reference-empty reference-cad-note">
              <b>{asset.name}</b>
              <p>
                CAD remains dimensional evidence. For fast visual alignment use
                the brochure PDF or a raster plan; Rekixo will not guess unsupported
                DWG geometry.
              </p>
            </div>
          )}
        </div>

        <aside className="reference-controls">
          <div className="section-label">1 · PLAN SCALE</div>
          {kind === "image" ? (
            <>
              <p>
                Plan पर किसी known dimension के दोनों ends A और B click करें,
                distance metres में डालें और Calibrate दबाएँ.
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
                Calibrate & show under model
              </button>
              {layer?.metresPerPixel && (
                <div className="reference-calibrated">
                  <b>Plan ready ✓</b>
                  <small>
                    {(layer.metresPerPixel * 1000).toFixed(3)} mm / px
                    {widthM && heightM
                      ? ` · ${widthM.toFixed(2)} × ${heightM.toFixed(2)} m`
                      : ""}
                  </small>
                </div>
              )}
            </>
          ) : kind === "pdf" ? (
            <p>
              पहले PDF page को alignment image बनाइए. Original PDF source
              untouched रहेगा.
            </p>
          ) : (
            <p>Visual calibration brochure PDF या plan image पर करें.</p>
          )}

          {layer && (
            <>
              <div className="section-label">REFERENCE VISIBILITY</div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  disabled={disabled}
                  onChange={(event) => upsert({ visible: event.target.checked })}
                />
                Show plan under model
              </label>
              <label className="reference-opacity">
                <span>Plan opacity <b>{Math.round(layer.opacity * 100)}%</b></span>
                <input
                  aria-label="Plan opacity"
                  type="range"
                  min="0.08"
                  max="0.92"
                  step="0.02"
                  value={layer.opacity}
                  disabled={disabled}
                  onChange={(event) =>
                    upsert({
                      opacity: Math.min(
                        0.92,
                        Math.max(0.08, numberValue(event.target.value, layer.opacity)),
                      ),
                    })
                  }
                />
              </label>
            </>
          )}

          <div className="section-label">2 · MODEL</div>
          <p>
            ऊपर Move/Rotate चुनें और viewport के gizmo को mouse या touch से
            drag करें. Normal workflow में X/Z numbers भरने की जरूरत नहीं है.
          </p>

          <details className="reference-advanced">
            <summary>Advanced numeric alignment</summary>
            {layer && (
              <>
                <div className="section-label">REFERENCE PLANE</div>
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
            <div className="section-label">MODEL TRANSFORM</div>
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
          </details>
        </aside>
      </div>
    </section>
  );
}

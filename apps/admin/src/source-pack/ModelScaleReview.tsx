import { useEffect, useMemo, useState } from "react";
import { ADMIN_BASE_PATH } from "@rekixo/3d-contracts";
import "./model-scale-review.css";

type ScaleDiagnostic = {
  code?: string;
  policy?: string;
  reason?: string;
  scaleBasis?: string;
  rawDimensions?: number[];
  canonicalDimensionsM?: number[];
  sourceUnitScaleFactorCmPerUnit?: number;
  appliedMetreScale?: number;
  minLargestDimensionM?: number;
  maxLargestDimensionM?: number;
};

type ScaleReview = {
  id: string;
  processingJobId: string;
  sourcePackId: string;
  sourceFileId: string;
  sourceSha256: string;
  status: "pending" | "approved";
  diagnostic: ScaleDiagnostic;
  metresPerSourceUnit: number | null;
  decisionNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ScaleReviewPayload = {
  contractVersion: 1;
  schemaReady: boolean;
  project?: { id: string; slug: string; name: string; status: string };
  review?: ScaleReview | null;
  error?: string;
};

function reviewPath(slug: string) {
  return `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/model-scale-review`;
}

function sourceDimensions(values: number[] | undefined) {
  if (!Array.isArray(values) || values.length !== 3) return "Unavailable";
  return values.map((value) => Number(value).toFixed(3)).join(" × ");
}

function metreDimensions(values: number[] | undefined) {
  if (!Array.isArray(values) || values.length !== 3) return "Unavailable";
  return values.map((value) => `${Number(value).toFixed(3)} m`).join(" × ");
}

function resultingDimensions(values: number[] | undefined, scale: number) {
  if (!Array.isArray(values) || values.length !== 3 || !Number.isFinite(scale) || scale <= 0)
    return "Enter a valid scale to preview the result.";
  return values.map((value) => `${(Number(value) * scale).toFixed(3)} m`).join(" × ");
}

export default function ModelScaleReview({
  slug,
  onApprovalChange,
}: {
  slug: string;
  onApprovalChange?: (approved: boolean) => void;
}) {
  const [data, setData] = useState<ScaleReviewPayload>();
  const [scaleText, setScaleText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    fetch(reviewPath(slug), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as ScaleReviewPayload;
        if (!response.ok) throw new Error(body.error || `Scale review API failed (${response.status}).`);
        return body;
      })
      .then((body) => {
        setData(body);
        setError("");
        const approved = body.review?.status === "approved";
        onApprovalChange?.(approved);
        const approvedScale = body.review?.metresPerSourceUnit;
        if (Number.isFinite(approvedScale) && Number(approvedScale) > 0)
          setScaleText(String(approvedScale));
        if (body.review?.decisionNote) setNote(body.review.decisionNote);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          onApprovalChange?.(false);
          setError(reason instanceof Error ? reason.message : "Scale review load nahi hua.");
        }
      });
    return () => controller.abort();
  }, [slug, onApprovalChange]);

  const review = data?.review ?? null;
  const selectedScale = Number(scaleText);
  const preview = useMemo(
    () => resultingDimensions(review?.diagnostic.rawDimensions, selectedScale),
    [review?.diagnostic.rawDimensions, selectedScale],
  );

  async function approve() {
    if (!review || review.status !== "pending") return;
    if (
      !Number.isFinite(selectedScale) ||
      selectedScale < 0.000001 ||
      selectedScale > 1000000
    ) {
      setError("Valid metres-per-source-unit value enter karo.");
      return;
    }
    const cleanNote = note.trim();
    if (cleanNote.length < 12 || cleanNote.length > 1000) {
      setError("Approval note 12 se 1000 characters ke beech hona chahiye.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(reviewPath(slug), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          reviewId: review.id,
          metresPerSourceUnit: selectedScale,
          note: cleanNote,
        }),
      });
      const body = (await response.json()) as ScaleReviewPayload;
      if (!response.ok) throw new Error(body.error || `Scale approval failed (${response.status}).`);
      setData(body);
      onApprovalChange?.(body.review?.status === "approved");
      setMessage("Scale decision approved and locked. Ab Retry Processing isi exact audited scale ko use karega.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Scale approve nahi hua.");
    } finally {
      setBusy(false);
    }
  }

  if (!review && !error) return null;

  return (
    <section className="model-scale-review" aria-label="FBX model scale review">
      <div className="model-scale-review__head">
        <div>
          <p>METRIC SAFETY REVIEW</p>
          <h3>Building scale needs explicit approval</h3>
          <span>
            FBX metadata se nikla size suspicious hai. Engine koi replacement scale guess nahi karega; approved value aur reason audit history me lock honge.
          </span>
        </div>
        <strong>{review?.status === "approved" ? "APPROVED" : "REVIEW REQUIRED"}</strong>
      </div>

      {error ? <div className="model-scale-review__alert model-scale-review__alert--error">{error}</div> : null}
      {message ? <div className="model-scale-review__alert model-scale-review__alert--ok">{message}</div> : null}

      {review ? (
        <>
          <div className="model-scale-review__facts">
            <article>
              <span>SOURCE BOUNDS</span>
              <strong>{sourceDimensions(review.diagnostic.rawDimensions)}</strong>
              <small>Source-space units before any metre conversion.</small>
            </article>
            <article>
              <span>DECLARED RESULT</span>
              <strong>{metreDimensions(review.diagnostic.canonicalDimensionsM)}</strong>
              <small>
                UnitScaleFactor {Number(review.diagnostic.sourceUnitScaleFactorCmPerUnit ?? 0)} · applied {Number(review.diagnostic.appliedMetreScale ?? 0)} m/unit
              </small>
            </article>
            <article>
              <span>SAFETY RESULT</span>
              <strong>{review.diagnostic.reason || "Scale review required"}</strong>
              <small>{review.diagnostic.policy || "Metric sanity policy"}</small>
            </article>
          </div>

          {review.status === "pending" ? (
            <div className="model-scale-review__decision">
              <label>
                <span>Approved metres per source unit</span>
                <input
                  type="number"
                  min="0.000001"
                  max="1000000"
                  step="any"
                  inputMode="decimal"
                  placeholder="Example: 1"
                  value={scaleText}
                  onChange={(event) => setScaleText(event.target.value)}
                  disabled={busy}
                />
              </label>
              <div className="model-scale-review__preview">
                <span>Preview with this value</span>
                <strong>{preview}</strong>
                <small>
                  Koi default scale assume nahi kiya gaya hai. Source drawing/evidence se confirm value hi enter karein.
                </small>
              </div>
              <label className="model-scale-review__note">
                <span>Approval reason / evidence</span>
                <textarea
                  rows={3}
                  maxLength={1000}
                  placeholder="Example: supplied plan dimensions confirm 1 source unit = 1 metre."
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={busy}
                />
                <small>{note.trim().length}/1000 · minimum 12 characters</small>
              </label>
              <button type="button" onClick={() => void approve()} disabled={busy}>
                {busy ? "Approving…" : "Approve audited scale"}
              </button>
            </div>
          ) : (
            <div className="model-scale-review__approved">
              <div>
                <span>LOCKED SCALE</span>
                <strong>{review.metresPerSourceUnit} m / source unit</strong>
                <small>
                  {review.approvedBy ? `Approved by ${review.approvedBy}` : "Approved"}
                  {review.approvedAt ? ` · ${new Date(review.approvedAt).toLocaleString()}` : ""}
                </small>
              </div>
              {review.decisionNote ? <p>{review.decisionNote}</p> : null}
              <p>Retry Processing ab decision ID aur exact scale provenance ke saath chalega.</p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

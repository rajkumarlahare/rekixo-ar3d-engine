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

function dimensions(values: number[] | undefined) {
  if (!Array.isArray(values) || values.length !== 3) return "Unavailable";
  return values.map((value) => `${Number(value).toFixed(3)} m`).join(" × ");
}

function resultingDimensions(values: number[] | undefined, scale: number) {
  if (!Array.isArray(values) || values.length !== 3 || !Number.isFinite(scale) || scale <= 0)
    return "Enter a valid scale to preview the result.";
  return values.map((value) => `${(Number(value) * scale).toFixed(3)} m`).join(" × ");
}

export default function ModelScaleReview({ slug }: { slug: string }) {
  const [data, setData] = useState<ScaleReviewPayload>();
  const [scaleText, setScaleText] = useState("1");
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
        const approved = body.review?.metresPerSourceUnit;
        if (Number.isFinite(approved) && Number(approved) > 0) setScaleText(String(approved));
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Scale review load nahi hua.");
      });
    return () => controller.abort();
  }, [slug]);

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
        }),
      });
      const body = (await response.json()) as ScaleReviewPayload;
      if (!response.ok) throw new Error(body.error || `Scale approval failed (${response.status}).`);
      setData(body);
      setMessage("Scale decision approved and locked. Ab Retry Processing dabao; next attempt isi exact scale ko use karega.");
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
            FBX metadata se nikla size suspicious hai. Engine koi scale guess nahi karega; approved value audit history me lock hogi.
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
              <strong>{dimensions(review.diagnostic.rawDimensions)}</strong>
              <small>Numbers are source-space units before metre conversion.</small>
            </article>
            <article>
              <span>DECLARED RESULT</span>
              <strong>{dimensions(review.diagnostic.canonicalDimensionsM)}</strong>
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
                  value={scaleText}
                  onChange={(event) => setScaleText(event.target.value)}
                  disabled={busy}
                />
              </label>
              <div>
                <span>Preview with this value</span>
                <strong>{preview}</strong>
                <small>
                  1.0 ka matlab: 1 source unit = 1 metre. Sirf source/evidence dekhkar confirm hone par approve karein.
                </small>
              </div>
              <button type="button" onClick={() => void approve()} disabled={busy}>
                {busy ? "Approving…" : "Approve scale"}
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
              <p>Ab Retry Processing use karo. Processor decision ID aur exact scale provenance verify karega.</p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

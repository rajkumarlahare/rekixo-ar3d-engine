import { useState } from "react";
import type { Project } from "./domain";
import type { ModelMaterialSummary } from "./sceneCanvasModel";
import type { FbxSourceAudit } from "./sourceAudit";
import type { VisualDifferenceResult } from "./visualDifference";
import {
  buildVisualFacadeReview,
  type VisualReviewAction,
} from "./visualFacadeReview";

export default function VisualFacadeReview({
  project,
  audits,
  materials,
  referenceNames,
  disabled,
  onApply,
  onScoreRequest,
  visualDifference,
  scoreBusy,
}: {
  project: Project;
  audits: readonly FbxSourceAudit[];
  materials: readonly ModelMaterialSummary[];
  referenceNames?: Readonly<Record<string, string>>;
  disabled: boolean;
  onApply: (action: VisualReviewAction) => void;
  onScoreRequest?: () => void;
  visualDifference?: VisualDifferenceResult;
  scoreBusy?: boolean;
}) {
  const [viewAligned, setViewAligned] = useState(false);
  const { plan, key, sourceAvailable } = buildVisualFacadeReview(project, audits);
  const appearanceMatches =
    plan.appearance &&
    Object.entries(plan.appearance.appearance).every(
      ([field, value]) =>
        project.scene.appearance?.[
          field as keyof NonNullable<Project["scene"]["appearance"]>
        ] === value,
    );
  const primaryName = plan.primarySourceAssetId
    ? referenceNames?.[plan.primarySourceAssetId]
    : undefined;

  return (
    <details
      className="editor-materials editor-inspector-details"
      data-testid="visual-facade-review"
    >
      <summary>Reference look review</summary>
      <p>
        Review each appearance suggestion before applying. Every accepted change
        can be undone with Undo.
      </p>
      <small>
        Image regions are non-metric appearance evidence only. They never change
        measured walls, rooms, openings, floors or structural geometry.
      </small>
      {!sourceAvailable ? (
        <p>Attach and analyze a visual reference image to review its look.</p>
      ) : (
        <fieldset disabled={disabled}>
          <p data-testid="visual-reference-summary">
            Primary reference: {primaryName ?? "Analyzed image"} · Evidence
            confidence {Math.round(plan.evidenceConfidence * 100)}% · {plan.counts.regions}{" "}
            color region{plan.counts.regions === 1 ? "" : "s"} across {plan.counts.references}{" "}
            reference{plan.counts.references === 1 ? "" : "s"}
          </p>

          {plan.references.length > 1 && (
            <section aria-label="Visual reference arbitration">
              <b>Multiple reference arbitration</b>
              {plan.references.map((reference) => (
                <p key={reference.sourceAssetId}>
                  {reference.selected ? "Primary · " : "Corroborating · "}
                  {referenceNames?.[reference.sourceAssetId] ?? reference.sourceAssetId}
                  {" · "}{Math.round(reference.confidence * 100)}% · {reference.lightingMood}
                  {" · "}{reference.regionCount} regions
                </p>
              ))}
              {plan.lightingConflict && (
                <p role="alert">
                  References disagree on lighting. Rekixo will not silently merge
                  those looks; choose/review the intended result.
                </p>
              )}
            </section>
          )}

          {plan.appearance && (
            <section aria-label="Reference lighting suggestion">
              <b>
                Suggested lighting: {
                  project.scene.referenceImageEvidence?.lightingMood ?? "unknown"
                }
              </b>
              {plan.appearance.reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
              <button
                type="button"
                disabled={Boolean(appearanceMatches)}
                onClick={() => onApply({ key, kind: "appearance" })}
              >
                {appearanceMatches
                  ? "Lighting already matches"
                  : "Apply reviewed lighting"}
              </button>
            </section>
          )}

          {!plan.materials.length && (
            <p>
              No eligible material suggestions for the active audited FBX model.
              You can still use Materials to edit its look manually.
            </p>
          )}
          {plan.materials.map((suggestion) => {
            const loaded = materials.find(
              (material) => material.name === suggestion.materialName,
            );
            const override = project.scene.materialOverrides?.find(
              (material) => material.materialName === suggestion.materialName,
            );
            const current = override?.baseColor ?? loaded?.baseColor;
            const atLimit =
              !override && (project.scene.materialOverrides?.length ?? 0) >= 250;
            return (
              <section
                key={suggestion.materialName}
                aria-label={`Review ${suggestion.materialName}`}
              >
                <b>{suggestion.materialName}</b>
                <p>
                  {suggestion.role} · {suggestion.correspondence === "region"
                    ? "facade region correspondence"
                    : "whole-image palette fallback"}
                  {" · "}Confidence {Math.round(suggestion.confidence * 100)}%
                </p>
                <p>{suggestion.reason}</p>
                <p>Current: {current ?? "not loaded"}</p>
                {suggestion.candidates.map((candidate) => {
                  const matches =
                    current?.toLowerCase() === candidate.baseColor.toLowerCase();
                  const name =
                    referenceNames?.[candidate.sourceAssetId] ??
                    (candidate.sourceAssetId === plan.primarySourceAssetId
                      ? "Primary reference"
                      : "Reference image");
                  return (
                    <div
                      key={`${candidate.sourceAssetId}:${candidate.regionId ?? candidate.baseColor}`}
                      className="visual-region-candidate"
                    >
                      <p>
                        <span
                          style={{
                            backgroundColor: candidate.baseColor,
                            display: "inline-block",
                            width: 20,
                            height: 20,
                            verticalAlign: "middle",
                          }}
                          aria-hidden="true"
                        />{" "}
                        {candidate.baseColor} · {name}
                        {candidate.regionId ? ` · ${candidate.regionId}` : ""}
                        {candidate.coverage !== undefined
                          ? ` · ${Math.round(candidate.coverage * 100)}% image coverage`
                          : ""}
                        {" · "}{Math.round(candidate.confidence * 100)}%
                      </p>
                      <button
                        type="button"
                        disabled={!loaded || matches || atLimit}
                        onClick={() =>
                          onApply({
                            key,
                            kind: "material",
                            materialName: suggestion.materialName,
                            sourceAssetId: candidate.sourceAssetId,
                            regionId: candidate.regionId,
                          })
                        }
                      >
                        {matches
                          ? "Color already matches"
                          : `Apply this region color to ${suggestion.materialName}`}
                      </button>
                    </div>
                  );
                })}
                {!loaded && (
                  <p>This exact material is not available in the loaded model.</p>
                )}
                {atLimit && (
                  <p>Remove an existing material override before adding another.</p>
                )}
              </section>
            );
          })}

          {onScoreRequest && (
            <section aria-label="Visual difference score">
              <b>Compare current rendered view</b>
              <p>
                Match the 3D camera/framing to the reference first. Background,
                sky, occlusion and camera angle affect this appearance-only score.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={viewAligned}
                  onChange={(event) => setViewAligned(event.target.checked)}
                />{" "}
                I aligned the current camera/view to the primary reference
              </label>
              <button
                type="button"
                disabled={!viewAligned || scoreBusy}
                onClick={onScoreRequest}
              >
                {scoreBusy ? "Scoring current view…" : "Score current view"}
              </button>
              {visualDifference?.viewpointAligned &&
                visualDifference.similarityPercent !== undefined && (
                  <div data-testid="visual-difference-score">
                    <p>
                      Appearance similarity: <b>{visualDifference.similarityPercent}%</b>
                      {" · "}{visualDifference.status}
                    </p>
                    {visualDifference.components && (
                      <small>
                        Palette difference {Math.round(visualDifference.components.palette * 100)}%
                        {" · "}light {Math.round(visualDifference.components.luminance * 100)}%
                        {" · "}saturation {Math.round(visualDifference.components.saturation * 100)}%
                        {" · "}edge structure {Math.round(visualDifference.components.edgeStructure * 100)}%
                      </small>
                    )}
                    <p>{visualDifference.detail}</p>
                  </div>
                )}
            </section>
          )}

          {plan.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </fieldset>
      )}
    </details>
  );
}

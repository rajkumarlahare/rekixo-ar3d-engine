import type { Project } from "./domain";
import type { ModelMaterialSummary } from "./sceneCanvasModel";
import type { FbxSourceAudit } from "./sourceAudit";
import { buildVisualFacadeReview, type VisualReviewAction } from "./visualFacadeReview";

export default function VisualFacadeReview({ project, audits, materials, referenceName, disabled, onApply }: {
  project: Project;
  audits: readonly FbxSourceAudit[];
  materials: readonly ModelMaterialSummary[];
  referenceName?: string;
  disabled: boolean;
  onApply: (action: VisualReviewAction) => void;
}) {
  const { plan, key, sourceAvailable } = buildVisualFacadeReview(project, audits);
  const appearanceMatches = plan.appearance && Object.entries(plan.appearance.appearance).every(
    ([field, value]) => project.scene.appearance?.[field as keyof NonNullable<Project["scene"]["appearance"]>] === value,
  );
  return (
    <details className="editor-materials editor-inspector-details">
      <summary>Reference look review</summary>
      <p>Review each suggestion before applying. Each Apply can be undone with Undo.</p>
      <small>Palette and material-name suggestions are approximate; facade regions have not been matched. Dimensions and geometry stay unchanged.</small>
      {!sourceAvailable ? (
        <p>Attach and analyze a reference image to review its look.</p>
      ) : (
        <fieldset disabled={disabled}>
          <p>Reference: {referenceName ?? "Analyzed image"} · Evidence confidence {Math.round(plan.evidenceConfidence * 100)}%</p>
          {plan.appearance && (
            <section aria-label="Reference lighting suggestion">
              <b>Suggested lighting: {project.scene.referenceImageEvidence?.lightingMood}</b>
              {project.scene.referenceImageEvidence?.lightingMood === "unknown" && <p>Lighting is uncertain. This is a daylight fallback; review carefully.</p>}
              {plan.appearance.reasons.map((reason) => <p key={reason}>{reason}</p>)}
              <button type="button" disabled={Boolean(appearanceMatches)} onClick={() => onApply({ key, kind: "appearance" })}>
                {appearanceMatches ? "Lighting already matches" : "Apply reviewed lighting"}
              </button>
            </section>
          )}
          {!plan.materials.length && <p>No eligible material suggestions for the active audited FBX model. You can still use Materials to edit its look manually.</p>}
          {plan.materials.map((suggestion) => {
            const loaded = materials.find((material) => material.name === suggestion.materialName);
            const override = project.scene.materialOverrides?.find((material) => material.materialName === suggestion.materialName);
            const current = override?.baseColor ?? loaded?.baseColor;
            const matches = current?.toLowerCase() === suggestion.baseColor;
            const atLimit = !override && (project.scene.materialOverrides?.length ?? 0) >= 250;
            return (
              <section key={suggestion.materialName} aria-label={`Review ${suggestion.materialName}`}>
                <b>{suggestion.materialName}</b>
                <p>{suggestion.role} · Confidence {Math.round(suggestion.confidence * 100)}%</p>
                <p>{suggestion.reason}</p>
                <p>Current: {current ?? "not loaded"} → Suggested: <span style={{ backgroundColor: suggestion.baseColor, display: "inline-block", width: 20, height: 20, verticalAlign: "middle" }} aria-hidden="true" /> {suggestion.baseColor}</p>
                <button type="button" disabled={!loaded || matches || atLimit} onClick={() => onApply({ key, kind: "material", materialName: suggestion.materialName })}>
                  {matches ? "Color already matches" : `Apply color to ${suggestion.materialName}`}
                </button>
                {!loaded && <p>This exact material is not available in the loaded model.</p>}
                {atLimit && <p>Remove an existing material override before adding another.</p>}
              </section>
            );
          })}
          {plan.issues.map((issue) => <p key={issue}>{issue}</p>)}
        </fieldset>
      )}
    </details>
  );
}

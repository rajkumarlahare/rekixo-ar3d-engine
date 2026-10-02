import type { ModelMaterialSummary } from "./SceneCanvas";
import type { MaterialOverride } from "./domain";
import {
  MATERIAL_PRESETS,
  suggestedMaterialPreset,
} from "./materialPresets";

function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  step: number,
) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

export default function MaterialQuickEditor({
  materials,
  selected,
  override,
  disabled,
  onSelect,
  onPatch,
  onReset,
}: {
  materials: readonly ModelMaterialSummary[];
  selected: string;
  override?: MaterialOverride;
  disabled: boolean;
  onSelect: (name: string) => void;
  onPatch: (change: Partial<MaterialOverride>) => void;
  onReset: () => void;
}) {
  const summary = materials.find((material) => material.name === selected);
  const suggested = selected ? suggestedMaterialPreset(selected) : undefined;

  return (
    <details className="editor-materials editor-inspector-details">
      <summary>Materials</summary>
      {!materials.length ? (
        <small>Load the building model to inspect editable runtime materials.</small>
      ) : (
        <>
          <label>
            Model material
            <select
              value={selected}
              onChange={(event) => onSelect(event.target.value)}
              disabled={disabled}
            >
              {materials.map((material) => (
                <option key={material.name} value={material.name}>
                  {material.name} · {material.meshCount} mesh
                  {material.meshCount === 1 ? "" : "es"}
                </option>
              ))}
            </select>
          </label>
          {summary && (
            <fieldset disabled={disabled}>
              <div
                className="material-preset-grid"
                role="group"
                aria-label="Quick material finishes"
              >
                {MATERIAL_PRESETS.map((preset) => {
                  const recommended = suggested?.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={
                        recommended
                          ? "material-preset recommended"
                          : "material-preset"
                      }
                      title={preset.detail}
                      onClick={() => onPatch(preset.override)}
                    >
                      <span
                        className={`material-preset-swatch material-preset-swatch--${preset.id}`}
                        aria-hidden="true"
                      />
                      <span>
                        <b>{preset.label}</b>
                        <small>
                          {recommended ? "Suggested" : preset.detail}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>

              <details className="material-fine-tune">
                <summary>Fine tune material</summary>
                <div className="material-color-row">
                  <label>
                    Base color
                    <input
                      type="color"
                      value={override?.baseColor ?? summary.baseColor}
                      onChange={(event) =>
                        onPatch({ baseColor: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Emissive
                    <input
                      type="color"
                      value={override?.emissive ?? summary.emissive}
                      onChange={(event) =>
                        onPatch({ emissive: event.target.value })
                      }
                    />
                  </label>
                </div>
                {numberField(
                  "Roughness",
                  override?.roughness ?? summary.roughness,
                  (roughness) => onPatch({ roughness }),
                  0.05,
                )}
                {numberField(
                  "Metalness",
                  override?.metalness ?? summary.metalness,
                  (metalness) => onPatch({ metalness }),
                  0.05,
                )}
                {numberField(
                  "Opacity",
                  override?.opacity ?? summary.opacity,
                  (opacity) => onPatch({ opacity }),
                  0.05,
                )}
                {numberField(
                  "Emissive intensity",
                  override?.emissiveIntensity ?? summary.emissiveIntensity,
                  (emissiveIntensity) => onPatch({ emissiveIntensity }),
                  0.1,
                )}
                <button type="button" disabled={!override} onClick={onReset}>
                  Reset material override
                </button>
              </details>
              <small>
                Quick finishes change only the runtime look; imported source bytes
                stay unchanged.
              </small>
            </fieldset>
          )}
        </>
      )}
    </details>
  );
}

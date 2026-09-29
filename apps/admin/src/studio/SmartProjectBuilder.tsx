import { useMemo, useRef, useState } from "react";
import type { Asset, Project } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import type { SmartProjectAnalysis, SmartSourceRole } from "./projectAnalyzer";
import type { OpeningSuggestion } from "./openingAssociator";

const ROLE_LABEL: Record<SmartSourceRole, string> = {
  model: "3D model",
  cad: "CAD / model source",
  drawing: "Drawing / brochure",
  visual: "Visual reference",
  texture: "Texture",
  metadata: "Metadata",
  data: "Structured data",
  other: "Other",
};

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

export default function SmartProjectBuilder({
  project,
  files,
  audits,
  analysis,
  openingSuggestions,
  busy,
  onProjectMeta,
  onImportFiles,
  onAnalyze,
  onSelectModel,
  onBuildDraft,
  onApplyArchitecturalCandidates,
  onApproveOpening,
  onApproveReadyOpenings,
  onOpenEditor,
  onOpenSources,
}: {
  project: Project;
  files: Asset[];
  audits: FbxSourceAudit[];
  analysis?: SmartProjectAnalysis;
  openingSuggestions: OpeningSuggestion[];
  busy: boolean;
  onProjectMeta: (
    change: Partial<
      Pick<Project, "name" | "location" | "referenceUrl" | "brief">
    >,
  ) => void;
  onImportFiles: (files: File[]) => void;
  onAnalyze: () => void;
  onSelectModel: (assetId: string) => void;
  onBuildDraft: () => void;
  onApplyArchitecturalCandidates: () => void;
  onApproveOpening: (suggestion: OpeningSuggestion) => void;
  onApproveReadyOpenings: () => void;
  onOpenEditor: () => void;
  onOpenSources: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const modelCandidates = files.filter((file) => /\.(glb|fbx)$/i.test(file.name));
  const roles = useMemo(() => {
    const count = new Map<SmartSourceRole, number>();
    for (const source of analysis?.sources ?? [])
      count.set(source.role, (count.get(source.role) ?? 0) + 1);
    return [...count.entries()];
  }, [analysis]);
  const architecturalCounts = useMemo(() => {
    const rows = analysis?.architecturalCandidates ?? [];
    return {
      wall: rows.filter((row) => row.kind === "wall").length,
      door: rows.filter((row) => row.kind === "door").length,
      window: rows.filter((row) => row.kind === "window").length,
      confident: rows.filter((row) => row.confidence >= 0.82).length,
      review: rows.filter((row) => row.confidence < 0.82).length,
    };
  }, [analysis]);
  const approvedOpeningKeys = useMemo(
    () =>
      new Set(
        (project.scene.openings ?? [])
          .filter(
            (opening) =>
              opening.sourceNodeName && opening.sourceOccurrence !== undefined,
          )
          .map(
            (opening) =>
              `${opening.sourceNodeName}\u0000${opening.sourceOccurrence}`,
          ),
      ),
    [project.scene.openings],
  );
  const openingCounts = useMemo(
    () => ({
      ready: openingSuggestions.filter(
        (suggestion) =>
          suggestion.ready && !approvedOpeningKeys.has(suggestion.key),
      ).length,
      review: openingSuggestions.filter((suggestion) => !suggestion.ready)
        .length,
      approved: openingSuggestions.filter((suggestion) =>
        approvedOpeningKeys.has(suggestion.key),
      ).length,
    }),
    [openingSuggestions, approvedOpeningKeys],
  );

  function takeFiles(list: FileList | File[]) {
    const next = Array.from(list);
    if (next.length) onImportFiles(next);
  }

  return (
    <section className="smart-builder" aria-label="Smart 3D project builder">
      <div className="builder-hero">
        <div>
          <span className="ops-eyebrow">SMART PROJECT BUILDER V1</span>
          <h2>Files दीजिए, Rekixo draft structure तैयार करेगा</h2>
          <p>
            Normal workflow में coordinates, floor heights और hundreds of mesh
            tags type करने की जरूरत नहीं होनी चाहिए. Rekixo source files analyze
            करेगा; आप visual result review और mouse से correction करेंगे.
          </p>
        </div>
        <div className="builder-hero-actions">
          <button type="button" onClick={onOpenEditor}>
            Open visual editor
          </button>
          <button type="button" onClick={onOpenSources}>
            Source library
          </button>
        </div>
      </div>

      <div className="builder-progress" aria-label="Project builder flow">
        {[
          ["1", "Project", Boolean(project.name.trim())],
          ["2", "Sources", files.length > 0],
          ["3", "Analyze", Boolean(analysis)],
          ["4", "Build Draft", project.scene.floors.length > 1 || Boolean(project.scene.modelNodeTags?.length)],
          ["5", "Review", false],
        ].map(([index, label, complete]) => (
          <div className={complete ? "complete" : ""} key={String(label)}>
            <span>{String(index)}</span>
            <b>{String(label)}</b>
          </div>
        ))}
      </div>

      <div className="builder-grid">
        <article className="builder-card builder-project-card">
          <div className="builder-card-head">
            <div>
              <span className="ops-eyebrow">1 · PROJECT</span>
              <h3>Basic project details</h3>
            </div>
            <span className="ops-pill ops-pill--ready">EASY SETUP</span>
          </div>
          <div className="builder-form">
            <label>
              Project title
              <input
                value={project.name}
                disabled={busy}
                onChange={(event) => onProjectMeta({ name: event.target.value })}
                placeholder="e.g. Riverfront Residency"
              />
            </label>
            <label>
              Location
              <input
                value={project.location ?? ""}
                disabled={busy}
                onChange={(event) =>
                  onProjectMeta({ location: event.target.value })
                }
                placeholder="Area / city"
              />
            </label>
            <label className="wide">
              Reference / client link
              <input
                value={project.referenceUrl ?? ""}
                disabled={busy}
                onChange={(event) =>
                  onProjectMeta({ referenceUrl: event.target.value })
                }
                placeholder="https://…"
              />
              <small>
                Optional authoring reference. It is not treated as geometry truth.
              </small>
            </label>
            <label className="wide">
              Project brief
              <textarea
                value={project.brief ?? ""}
                disabled={busy}
                onChange={(event) => onProjectMeta({ brief: event.target.value })}
                placeholder="Boss/client ने क्या reference दिया है, exterior/interior expectation, special notes…"
              />
            </label>
          </div>
        </article>

        <article className="builder-card builder-source-card">
          <div className="builder-card-head">
            <div>
              <span className="ops-eyebrow">2 · UNIVERSAL SOURCE DROP</span>
              <h3>सारी project files एक साथ डालें</h3>
            </div>
            {files.length > 0 && (
              <span className="ops-pill ops-pill--ready">{files.length} FILES</span>
            )}
          </div>
          <button
            type="button"
            className={dragging ? "builder-dropzone dragging" : "builder-dropzone"}
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget === event.target) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              takeFiles(event.dataTransfer.files);
            }}
          >
            <strong>Drop complete source pack here</strong>
            <span>
              GLB · FBX · DWG/DXF · SKP/SKB · PDF · JPG/PNG · DRS · CSV · textures
            </span>
            <small>या click करके multiple files चुनें</small>
          </button>
          <input
            ref={input}
            hidden
            multiple
            type="file"
            accept=".glb,.fbx,.dwg,.dxf,.skp,.skb,.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.drs,.json,.csv,.tsv"
            onChange={(event) => {
              if (event.target.files) takeFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {modelCandidates.length > 0 && (
            <label className="builder-model-picker">
              Active 3D model
              <select
                value={project.scene.modelId ?? ""}
                disabled={busy}
                onChange={(event) => onSelectModel(event.target.value)}
              >
                <option value="">Choose model…</option>
                {modelCandidates.map((file) => (
                  <option value={file.id} key={file.id}>
                    {file.name} · {formatBytes(file.size)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {audits.some(
            (audit) =>
              audit.externalTextureFiles.length >
              audit.matchedTextureFiles.length,
          ) && (
            <div className="builder-inline-warning">
              FBX external textures incomplete हैं. Geometry analysis safe रहेगा,
              लेकिन final visual quality के लिए missing texture files या
              self-contained GLB चाहिए.
            </div>
          )}
        </article>
      </div>

      <article className="builder-card builder-analysis-card">
        <div className="builder-card-head">
          <div>
            <span className="ops-eyebrow">3 · SMART ANALYSIS</span>
            <h3>Rekixo repetitive technical work पहले करे</h3>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy || files.length === 0}
            onClick={onAnalyze}
          >
            {analysis ? "Analyze again" : "Analyze project"}
          </button>
        </div>

        {!analysis ? (
          <div className="builder-empty-analysis">
            <b>Analysis अभी run नहीं हुआ</b>
            <p>
              Source classification, model bounds, meshes, materials, likely
              floor levels और automatic mesh-to-floor suggestions यहाँ आएँगे.
            </p>
          </div>
        ) : (
          <>
            <div className="builder-role-strip">
              {roles.map(([role, count]) => (
                <span key={role}>
                  {ROLE_LABEL[role]} <b>{count}</b>
                </span>
              ))}
            </div>
            <div className="builder-analysis-stats">
              <div>
                <span>MODEL</span>
                <strong>{analysis.modelName ?? "Not selected"}</strong>
                <small>{analysis.modelAssetId ? "Selected for analysis" : "Needs review"}</small>
              </div>
              <div>
                <span>MESHES</span>
                <strong>{analysis.meshCount || "—"}</strong>
                <small>source geometry nodes</small>
              </div>
              <div>
                <span>MATERIALS</span>
                <strong>{analysis.materialCount || "—"}</strong>
                <small>detected material identities</small>
              </div>
              <div>
                <span>FLOORS</span>
                <strong>{analysis.floorCandidates.length || "—"}</strong>
                <small>suggested level bands</small>
              </div>
              <div>
                <span>AUTO TAG</span>
                <strong>{analysis.highConfidenceAssignments}</strong>
                <small>high-confidence mesh assignments</small>
              </div>
              <div>
                <span>REVIEW</span>
                <strong>{analysis.reviewAssignments + analysis.commonAssignments}</strong>
                <small>manual confirmation candidates</small>
              </div>
            </div>

            {analysis.floorCandidates.length > 0 && (
              <div className="builder-floor-suggestions">
                <div>
                  <b>Detected floor levels</b>
                  <small>
                    Suggested values हैं; final architectural truth नहीं. Build
                    Draft के बाद mouse/section tools से adjust कर सकते हैं.
                  </small>
                </div>
                <div className="builder-floor-chips">
                  {analysis.floorCandidates.map((floor, index) => (
                    <span key={`${floor.elevation}:${index}`}>
                      {index === 0 ? "Ground" : `F${index}`}
                      <b>{floor.elevation.toFixed(3)} m</b>
                      <i>
                        {floor.confidence >= 0.8
                          ? "high"
                          : floor.confidence >= 0.6
                            ? "medium"
                            : "review"}
                      </i>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(analysis.architecturalCandidates.length > 0 ||
              analysis.cadAudits.length > 0) && (
              <div className="builder-architecture-review">
                <div className="builder-architecture-head">
                  <div>
                    <b>Architectural candidate detection</b>
                    <small>
                      Source geometry और readable CAD layer names से wall/door/window
                      suggestions. ये verified architecture नहीं हैं जब तक आप review
                      नहीं करते.
                    </small>
                  </div>
                  <button
                    type="button"
                    disabled={busy || architecturalCounts.confident === 0}
                    onClick={onApplyArchitecturalCandidates}
                  >
                    Apply {architecturalCounts.confident} confident labels
                  </button>
                </div>
                <div className="builder-architecture-stats">
                  <span>
                    Walls <b>{architecturalCounts.wall}</b>
                  </span>
                  <span>
                    Doors <b>{architecturalCounts.door}</b>
                  </span>
                  <span>
                    Windows <b>{architecturalCounts.window}</b>
                  </span>
                  <span>
                    Review <b>{architecturalCounts.review}</b>
                  </span>
                </div>
                {analysis.architecturalCandidates.length > 0 && (
                  <div className="builder-candidate-list">
                    {analysis.architecturalCandidates.slice(0, 14).map((candidate) => (
                      <div
                        key={`${candidate.nodeName}:${candidate.occurrence}:${candidate.kind}`}
                      >
                        <span className={`candidate-kind candidate-kind--${candidate.kind}`}>
                          {candidate.kind}
                        </span>
                        <span>
                          <b>{candidate.nodeName}</b>
                          <small>
                            occurrence {candidate.occurrence}
                            {candidate.floorIndex !== undefined
                              ? ` · floor ${candidate.floorIndex}`
                              : " · floor review"}
                          </small>
                        </span>
                        <span>
                          <b>{Math.round(candidate.confidence * 100)}%</b>
                          <small>{candidate.reasons.join(" · ") || "geometry hint"}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {analysis.cadAudits.length > 0 && (
                  <div className="builder-cad-audits">
                    {analysis.cadAudits.map((audit) => (
                      <div key={audit.assetId}>
                        <span
                          className={
                            audit.semanticReady
                              ? "ops-pill ops-pill--ready"
                              : "ops-pill ops-pill--warning"
                          }
                        >
                          {audit.kind.toUpperCase()}
                        </span>
                        <span>
                          <b>{audit.name}</b>
                          <small>{audit.note}</small>
                        </span>
                        <strong>{audit.layerHints.length} layer hints</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {openingSuggestions.length > 0 && (
              <div className="builder-opening-review">
                <div className="builder-architecture-head">
                  <div>
                    <b>Door / window wall association</b>
                    <small>
                      Detected opening को nearest mapped room wall से match किया
                      गया है. Approve करने तक कोई opening architectural truth नहीं
                      मानी जाती.
                    </small>
                  </div>
                  <button
                    type="button"
                    disabled={busy || openingCounts.ready === 0}
                    onClick={onApproveReadyOpenings}
                  >
                    Approve {openingCounts.ready} ready openings
                  </button>
                </div>
                <div className="builder-architecture-stats">
                  <span>
                    Ready <b>{openingCounts.ready}</b>
                  </span>
                  <span>
                    Review <b>{openingCounts.review}</b>
                  </span>
                  <span>
                    Approved <b>{openingCounts.approved}</b>
                  </span>
                </div>
                <div className="builder-opening-list">
                  {openingSuggestions.slice(0, 18).map((suggestion) => {
                    const approved = approvedOpeningKeys.has(suggestion.key);
                    const roomNames = suggestion.roomIds
                      .map((roomId) => {
                        const room = project.scene.rooms.find(
                          (entry) => entry.id === roomId,
                        );
                        return room ? `${room.unit} · ${room.name}` : roomId;
                      })
                      .join(" ↔ ");
                    return (
                      <div key={suggestion.key}>
                        <span
                          className={`candidate-kind candidate-kind--${suggestion.kind}`}
                        >
                          {suggestion.kind}
                        </span>
                        <span>
                          <b>{suggestion.sourceNodeName}</b>
                          <small>
                            {roomNames || "No mapped wall association"} ·{" "}
                            {suggestion.wallDistance < 999
                              ? `${suggestion.wallDistance.toFixed(2)} m from wall`
                              : "wall review"}
                          </small>
                        </span>
                        <span>
                          <b>
                            {suggestion.width.toFixed(2)} ×{" "}
                            {suggestion.height.toFixed(2)} m
                          </b>
                          <small>
                            confidence {Math.round(suggestion.confidence * 100)}%
                          </small>
                        </span>
                        {approved ? (
                          <strong className="opening-approved">Approved</strong>
                        ) : (
                          <button
                            type="button"
                            disabled={busy || !suggestion.ready}
                            title={
                              suggestion.ready
                                ? "Approve this wall opening"
                                : suggestion.reasons.join(" · ")
                            }
                            onClick={() => onApproveOpening(suggestion)}
                          >
                            {suggestion.ready ? "Approve" : "Needs review"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {!project.scene.rooms.length && (
                  <div className="builder-inline-warning">
                    Door/window wall association के लिए पहले Visual Room Mapper
                    में rooms map करें, फिर Analyze Project दोबारा चलाएँ.
                  </div>
                )}
              </div>
            )}

            {analysis.externalTextureRefs > 0 && (
              <div className="builder-texture-health">
                <span>Texture references</span>
                <b>
                  {analysis.matchedTextureRefs}/{analysis.externalTextureRefs} matched
                </b>
              </div>
            )}

            {analysis.issues.length > 0 && (
              <div className="builder-analysis-issues">
                {analysis.issues.map((issue) => (
                  <p key={issue}>{issue}</p>
                ))}
              </div>
            )}
          </>
        )}
      </article>

      <article className="builder-card builder-build-card">
        <div>
          <span className="ops-eyebrow">4 · BUILD DRAFT STRUCTURE</span>
          <h3>Automatic पहले, manual correction बाद में</h3>
          <p>
            Detected floors और confident source meshes से draft बनाइए. Multi-floor
            façade, shafts और ambiguous meshes जानबूझकर review में रहेंगे—Rekixo
            architectural facts invent नहीं करेगा.
          </p>
        </div>
        <div className="builder-build-actions">
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              !analysis?.modelAssetId ||
              analysis.floorCandidates.length === 0
            }
            onClick={onBuildDraft}
          >
            Build smart draft
          </button>
          <button type="button" disabled={busy} onClick={onOpenEditor}>
            Review visually
          </button>
        </div>
      </article>

      <div className="builder-principle">
        <b>Rekixo rule:</b> automatic analysis repetitive work कम करेगा; unclear
        dimensions, ambiguous units/rooms और conflicting source facts review में
        रहेंगे. Numeric controls Advanced Editor में available रहेंगे, normal
        workflow mouse-first रहेगा.
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { ADMIN_BASE_PATH } from "@rekixo/3d-contracts";
import "./source-pack-review.css";

type AuthoritySuggestion =
  | { status: "suggested"; sourceFileId: string; score: number; reason: string }
  | { status: "operator-review-required"; sourceFileId: null; reason: string };

type Suggestion = {
  sourceFileId: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  suggestedRoles: string[];
  suggestedCapabilities: string[];
  confidence: number;
  geometryAuthorityScore: number;
  rationaleCode: string;
};

type ReviewFile = {
  sourceFileId: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  uploadState: string;
  roles: string[];
  capabilities: string[];
  classificationOrigin: "automatic" | "operator";
  classificationConfidence: number;
  notes: string | null;
  sortOrder: number;
};

type SourcePack = {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "ready" | "superseded" | "failed";
  geometryAuthorityFileId: string | null;
  operatorApproved: boolean;
  manifestSha256: string | null;
  approvedBy: string | null;
  files: ReviewFile[];
  readiness: {
    ready: boolean;
    verifiedSourceCount: number;
    reviewedSourceCount: number;
    geometryAuthorityFileId: string | null;
    missingSourceIds: string[];
    staleSourceIds: string[];
  };
};

type ReviewPayload = {
  project: { id: string; slug: string; name: string; status: string };
  authoritySuggestion: AuthoritySuggestion;
  suggestions: Suggestion[];
  latestPack: SourcePack | null;
  operatorApprovalRequired: boolean;
  immutableAfterSeal: boolean;
  error?: string;
};

const optionalRoles = [
  ["material-recovery", "Material recovery"],
  ["evidence", "Evidence / dimensions"],
  ["content-reference", "Project content"],
  ["presentation-reference", "Visual reference"],
] as const;

function selectedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function apiPath(slug: string) {
  return `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/source-pack-review`;
}

async function readPayload(response: Response) {
  const body = (await response.json()) as ReviewPayload;
  if (!response.ok) throw new Error(body.error || `Source Pack API failed (${response.status}).`);
  return body;
}

export default function SourcePackReview() {
  const slug = selectedProjectSlug();
  const [data, setData] = useState<ReviewPayload>();
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    if (!slug) {
      setError("Project select karke Source Pack Review open karein.");
      return;
    }
    setError("");
    const payload = await readPayload(
      await fetch(apiPath(slug), { headers: { Accept: "application/json" }, cache: "no-store" }),
    );
    setData(payload);
    setFiles(payload.latestPack?.files ?? []);
    setDirty(false);
  }

  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "Source Pack Review load nahi hua."),
    );
  }, [slug]);

  async function post(body: Record<string, unknown>, label: string) {
    if (!slug) return;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const payload = await readPayload(
        await fetch(apiPath(slug), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setData(payload);
      setFiles(payload.latestPack?.files ?? []);
      setDirty(false);
      return payload;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Source Pack operation failed.");
      return undefined;
    } finally {
      setBusy("");
    }
  }

  async function refreshClassification() {
    if (!slug) return;
    setBusy("classify");
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `${ADMIN_BASE_PATH}/api/cloud/projects/${encodeURIComponent(slug)}/source-classification`,
        { method: "POST", headers: { Accept: "application/json" } },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Classification failed (${response.status}).`);
      await load();
      setMessage("Automatic source analysis refreshed. Final authority abhi bhi operator approval maangta hai.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Automatic analysis refresh failed.");
    } finally {
      setBusy("");
    }
  }

  async function startDraft() {
    const result = await post({ action: "start-draft" }, "start");
    if (result) setMessage(`Source Pack v${result.latestPack?.version} review draft ready.`);
  }

  function chooseAuthority(sourceFileId: string) {
    setFiles((current) =>
      current.map((file) => ({
        ...file,
        roles:
          file.sourceFileId === sourceFileId
            ? [...new Set([...file.roles.filter((role) => role !== "geometry-authority"), "geometry-authority"])]
            : file.roles.filter((role) => role !== "geometry-authority"),
      })),
    );
    setDirty(true);
  }

  function toggleRole(sourceFileId: string, role: string) {
    setFiles((current) =>
      current.map((file) => {
        if (file.sourceFileId !== sourceFileId) return file;
        const roles = file.roles.includes(role)
          ? file.roles.filter((item) => item !== role)
          : [...file.roles, role];
        return { ...file, roles };
      }),
    );
    setDirty(true);
  }

  function updateNotes(sourceFileId: string, notes: string) {
    setFiles((current) =>
      current.map((file) => (file.sourceFileId === sourceFileId ? { ...file, notes } : file)),
    );
    setDirty(true);
  }

  async function saveReview() {
    const pack = data?.latestPack;
    if (!pack || pack.status !== "draft") return;
    const result = await post(
      {
        action: "save-review",
        packId: pack.id,
        files: files.map((file) => ({
          sourceFileId: file.sourceFileId,
          roles: file.roles,
          capabilities: file.capabilities,
          notes: file.notes,
        })),
      },
      "save",
    );
    if (result) setMessage("Operator review saved. Seal karne se pehle geometry authority aur roles dobara check karein.");
  }

  async function sealPack() {
    const pack = data?.latestPack;
    if (!pack || pack.status !== "draft") return;
    if (dirty) {
      setError("Unsaved review changes hain. Source Pack seal karne se pehle Save Review karein.");
      return;
    }
    if (!window.confirm("Source Pack seal hone ke baad immutable ho jayega. Continue?")) return;
    const result = await post(
      { action: "seal", packId: pack.id, confirm: "SEAL SOURCE PACK" },
      "seal",
    );
    if (result) setMessage(`Source Pack v${result.latestPack?.version} sealed and immutable.`);
  }

  const pack = data?.latestPack;
  const authorityId = useMemo(
    () => files.find((file) => file.roles.includes("geometry-authority"))?.sourceFileId ?? null,
    [files],
  );
  const suggestionById = useMemo(
    () => new Map((data?.suggestions ?? []).map((item) => [item.sourceFileId, item])),
    [data],
  );
  const suggestedAuthorityId =
    data?.authoritySuggestion.status === "suggested"
      ? data.authoritySuggestion.sourceFileId
      : null;

  return (
    <main className="source-review">
      <header className="source-review__topbar">
        <a href={slug ? `/3Dprojects?project=${encodeURIComponent(slug)}` : "/3Dprojects"}>← Projects</a>
        <div>
          <small>REKIXO AR3D ENGINE</small>
          <strong>Source Pack Review</strong>
        </div>
        <button
          type="button"
          onClick={() => void refreshClassification()}
          disabled={Boolean(busy) || !slug || dirty}
          title={dirty ? "Save review changes before refreshing automatic analysis" : undefined}
        >
          {busy === "classify" ? "Analyzing…" : "Refresh automatic analysis"}
        </button>
      </header>

      <section className="source-review__hero">
        <div>
          <p>AUTOMATIC PRESENTATION ENGINE · SOURCE DECISION</p>
          <h1>{data?.project.name ?? "Source Pack Review"}</h1>
          <span>{slug || "No project selected"}</span>
        </div>
        <div className="source-review__rule">
          <strong>One geometry authority</strong>
          <span>FBX/GLB जैसे finished model को primary geometry रखें. DWG/PDF/reference files evidence हैं; architecture rebuild नहीं करेंगे.</span>
        </div>
      </section>

      {error ? <div className="source-review__alert source-review__alert--error">{error}</div> : null}
      {message ? <div className="source-review__alert source-review__alert--ok">{message}</div> : null}

      <section className="source-review__summary">
        <article>
          <span>AUTO SUGGESTION</span>
          <strong>
            {suggestedAuthorityId
              ? suggestionById.get(suggestedAuthorityId)?.filename ?? "Candidate ready"
              : "Operator decision required"}
          </strong>
          <small>{data?.authoritySuggestion.reason ?? "Run automatic analysis first"}</small>
        </article>
        <article>
          <span>SOURCE PACK</span>
          <strong>{pack ? `v${pack.version} · ${pack.status.toUpperCase()}` : "Not started"}</strong>
          <small>{pack?.manifestSha256 ? `Manifest ${pack.manifestSha256.slice(0, 12)}…` : "Seal creates immutable manifest"}</small>
        </article>
        <article>
          <span>VERIFIED FILES</span>
          <strong>{pack?.readiness.verifiedSourceCount ?? data?.suggestions.length ?? 0}</strong>
          <small>{dirty ? "Unsaved review changes" : pack?.readiness.ready ? "Review complete" : "Review / authority selection pending"}</small>
        </article>
      </section>

      {!pack || pack.status !== "draft" ? (
        <section className="source-review__start">
          <div>
            <p>{pack?.status === "ready" ? "SEALED SOURCE PACK" : "OPERATOR REVIEW"}</p>
            <h2>{pack?.status === "ready" ? `Source Pack v${pack.version} is immutable` : "Create review draft from verified originals"}</h2>
            <span>
              Automatic classifier suggestions copy होंगे, लेकिन geometry-authority role जानबूझकर blank रहेगा ताकि final source decision इंसान approve करे.
            </span>
          </div>
          <button type="button" onClick={() => void startDraft()} disabled={Boolean(busy) || !data?.suggestions.length}>
            {busy === "start" ? "Preparing…" : pack?.status === "ready" ? "+ Start next Source Pack version" : "Start Source Pack Review"}
          </button>
        </section>
      ) : (
        <>
          {suggestedAuthorityId && !authorityId ? (
            <section className="source-review__suggestion">
              <div>
                <strong>Recommended geometry authority</strong>
                <span>{suggestionById.get(suggestedAuthorityId)?.filename}</span>
              </div>
              <button type="button" onClick={() => chooseAuthority(suggestedAuthorityId)}>
                Use recommendation
              </button>
            </section>
          ) : null}

          <section className="source-review__files">
            <div className="source-review__section-head">
              <div>
                <p>VERIFIED ORIGINALS</p>
                <h2>Review file roles</h2>
              </div>
              <span>Geometry authority exactly one होना चाहिए.</span>
            </div>

            {files.map((file) => {
              const suggestion = suggestionById.get(file.sourceFileId);
              const isAuthority = file.roles.includes("geometry-authority");
              return (
                <article className={isAuthority ? "source-file source-file--authority" : "source-file"} key={file.sourceFileId}>
                  <div className="source-file__identity">
                    <label className="source-file__authority">
                      <input
                        type="radio"
                        name="geometry-authority"
                        checked={isAuthority}
                        onChange={() => chooseAuthority(file.sourceFileId)}
                      />
                      <span>Geometry authority</span>
                    </label>
                    <h3>{file.filename}</h3>
                    <small>{file.mediaType} · {formatBytes(file.byteSize)} · SHA {file.sha256.slice(0, 10)}…</small>
                    <div className="source-file__chips">
                      {file.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
                    </div>
                  </div>

                  <div className="source-file__analysis">
                    <strong>{suggestion?.rationaleCode ?? "operator-reviewed"}</strong>
                    <span>
                      Auto confidence {Math.round((suggestion?.confidence ?? file.classificationConfidence) * 100)}%
                      {suggestion?.geometryAuthorityScore ? ` · geometry ${Math.round(suggestion.geometryAuthorityScore * 100)}%` : ""}
                    </span>
                  </div>

                  <fieldset>
                    <legend>Supporting roles</legend>
                    {optionalRoles.map(([role, label]) => (
                      <label key={role}>
                        <input
                          type="checkbox"
                          checked={file.roles.includes(role)}
                          onChange={() => toggleRole(file.sourceFileId, role)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>

                  <label className="source-file__notes">
                    <span>Operator note</span>
                    <input
                      value={file.notes ?? ""}
                      onChange={(event) => updateNotes(file.sourceFileId, event.target.value)}
                      maxLength={1000}
                      placeholder="Optional: why this role/authority was chosen"
                    />
                  </label>
                </article>
              );
            })}
          </section>

          <section className="source-review__actions">
            <div>
              <strong>
                {dirty
                  ? "Unsaved review changes"
                  : authorityId
                    ? "Geometry authority selected"
                    : "Select one geometry authority"}
              </strong>
              <span>
                {dirty
                  ? "Save Review required hai. Unsaved authority, role ya note changes ko seal nahi kiya jayega."
                  : "Save keeps draft editable. Seal writes a SHA-256 manifest, approves the operator decision and makes this Source Pack immutable."}
              </span>
            </div>
            <button type="button" onClick={() => void saveReview()} disabled={Boolean(busy) || !authorityId || !dirty}>
              {busy === "save" ? "Saving…" : "Save Review"}
            </button>
            <button
              className="source-review__seal"
              type="button"
              onClick={() => void sealPack()}
              disabled={Boolean(busy) || dirty || !pack.readiness.ready}
              title={
                dirty
                  ? "Save review changes before sealing"
                  : pack.readiness.ready
                    ? "Seal immutable Source Pack"
                    : "Save a complete review before sealing"
              }
            >
              {busy === "seal" ? "Sealing…" : "Seal Source Pack"}
            </button>
          </section>
        </>
      )}
    </main>
  );
}

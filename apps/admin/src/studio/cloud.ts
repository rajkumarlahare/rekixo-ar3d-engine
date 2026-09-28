import {
  projectSlug,
  validateProject,
  type Asset,
  type Project,
} from "./domain";

const CLOUD_BASE = "/3Dprojects/api/cloud";

export interface CloudSession {
  configured: boolean;
  databaseReady: boolean;
  authenticated: boolean;
  user?: { email: string };
  expiresAt?: number;
}

export interface CloudProjectSummary {
  id: string;
  slug: string;
  name: string;
  location?: string;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  draftRevision?: number;
  assetCount: number;
}

export interface CloudReleaseSummary {
  id: string;
  version: number;
  manifestSha256: string;
  sourceDraftRevision?: number;
  createdBy: string;
  createdAt: string;
  active: boolean;
}

export interface CloudAssetSummary {
  id: string;
  projectId: string;
  kind: "model" | "reference" | "source" | "texture" | "other";
  name: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  refCount: number;
  orphanedAt?: string;
  createdAt: string;
  contentUrl: string;
}

async function api<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json")
    ? ((await response.json()) as T & { error?: string })
    : undefined;
  if (!response.ok)
    throw new Error(
      (body as { error?: string } | undefined)?.error ??
        `Cloud Admin request failed (${response.status}).`,
    );
  return body as T;
}

export const session = () => api<CloudSession>(`${CLOUD_BASE}/session`);

export async function login(email: string, password: string) {
  return api<{ ok: true; user: { email: string }; expiresAt: number }>(
    `${CLOUD_BASE}/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
}

export async function logout() {
  return api<{ ok: true }>(`${CLOUD_BASE}/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function projects(
  q = "",
  status: "active" | "archived" | "all" = "active",
  limit = 50,
  offset = 0,
) {
  const params = new URLSearchParams({
    q,
    status,
    limit: String(limit),
    offset: String(offset),
  });
  return api<{
    projects: CloudProjectSummary[];
    total: number;
    nextOffset: number;
    hasMore: boolean;
  }>(`${CLOUD_BASE}/projects?${params}`);
}

export async function ensureProject(project: Project) {
  validateProject(project);
  const slug = projectSlug(project);
  return api<{ project: CloudProjectSummary; created: boolean }>(
    `${CLOUD_BASE}/projects`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: project.id,
        slug,
        name: project.name,
        location: project.location ?? "",
      }),
    },
  );
}

export async function listAssets(slug: string) {
  return api<{ assets: CloudAssetSummary[] }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/assets`,
  );
}

async function digestSha256(blob: Blob) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
  );
  return Array.from(digest, (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

export async function uploadAsset(
  slug: string,
  asset: Asset,
  kind: CloudAssetSummary["kind"],
) {
  const params = new URLSearchParams({
    id: asset.id,
    kind,
    name: asset.name,
  });
  return api<{ asset: CloudAssetSummary; uploaded: boolean }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/assets?${params}`,
    {
      method: "POST",
      headers: {
        "Content-Type": asset.type || "application/octet-stream",
        "X-Rekixo-Sha256": asset.hash,
      },
      body: asset.blob,
    },
  );
}

export async function deleteAsset(slug: string, assetId: string) {
  return api<{ ok: true }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE" },
  );
}

export async function loadDraft(slug: string) {
  return api<{
    project: CloudProjectSummary;
    revision: number;
    updatedAt: string;
    draft: Project;
  }>(`${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/draft`);
}

export async function saveDraft(
  project: Project,
  expectedRevision: number | null,
) {
  validateProject(project);
  const slug = projectSlug(project);
  const draft = structuredClone(project);
  draft.slug = slug;
  delete draft.cloud;
  return api<{ ok: true; revision: number; updatedAt: string }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/draft`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, draft }),
    },
  );
}

export async function patchProject(
  slug: string,
  body:
    | { action: "archive" | "restore" }
    | { action: "metadata"; name: string; location?: string },
) {
  return api<{ ok: true; status?: string; name?: string; location?: string }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function downloadAsset(
  summary: CloudAssetSummary,
): Promise<Asset> {
  const response = await fetch(summary.contentUrl, {
    cache: "no-store",
    headers: { Accept: "*/*" },
  });
  if (!response.ok)
    throw new Error(`Could not download ${summary.name} (${response.status}).`);
  const blob = await response.blob();
  if (blob.size !== summary.byteSize)
    throw new Error(`Cloud asset size mismatch: ${summary.name}`);
  const hash = await digestSha256(blob);
  if (hash !== summary.sha256.toLowerCase())
    throw new Error(`Cloud asset checksum mismatch: ${summary.name}`);
  return {
    id: summary.id,
    projectId: summary.projectId,
    name: summary.name,
    type: summary.mimeType,
    size: summary.byteSize,
    hash,
    blob,
  };
}

export async function downloadProject(slug: string) {
  const [draftResult, assetResult] = await Promise.all([
    loadDraft(slug),
    listAssets(slug),
  ]);
  const project = structuredClone(draftResult.draft);
  project.slug = draftResult.project.slug;
  project.name = draftResult.project.name;
  project.location = draftResult.project.location ?? project.location ?? "";
  project.cloud = {
    revision: draftResult.revision,
    syncedAt: draftResult.updatedAt,
  };
  validateProject(project);

  const byId = new Map(assetResult.assets.map((asset) => [asset.id, asset]));
  const files: Asset[] = [];
  for (const assetId of project.assets) {
    const summary = byId.get(assetId);
    if (!summary)
      throw new Error(`Cloud draft asset metadata is missing: ${assetId}`);
    files.push(await downloadAsset(summary));
  }
  return { project, files };
}

export async function syncProject(project: Project, files: Asset[]) {
  validateProject(project);
  const slug = projectSlug(project);
  const created = await ensureProject({ ...project, slug });
  const remoteAssets = await listAssets(slug);
  const remoteById = new Map(remoteAssets.assets.map((asset) => [asset.id, asset]));
  const localById = new Map(files.map((asset) => [asset.id, asset]));

  for (const assetId of project.assets) {
    const local = localById.get(assetId);
    if (!local || local.projectId !== project.id)
      throw new Error(`Local asset is missing: ${assetId}`);
    const remote = remoteById.get(assetId);
    if (remote) {
      if (remote.sha256.toLowerCase() !== local.hash.toLowerCase())
        throw new Error(`Cloud asset ID has different bytes: ${local.name}`);
      continue;
    }
    await uploadAsset(
      slug,
      local,
      assetId === project.scene.modelId ? "model" : "reference",
    );
  }

  let expectedRevision = project.cloud?.revision ?? null;
  if (!created.created && expectedRevision === null) {
    try {
      const existing = await loadDraft(slug);
      if (existing)
        throw new Error(
          "This cloud project already has a draft. Open the cloud version before overwriting it.",
        );
    } catch (error) {
      if (
        error instanceof Error &&
        /Cloud draft not found/i.test(error.message)
      ) {
        expectedRevision = null;
      } else {
        throw error;
      }
    }
  }

  const saved = await saveDraft({ ...project, slug }, expectedRevision);
  const next: Project = {
    ...project,
    slug,
    cloud: {
      revision: saved.revision,
      syncedAt: saved.updatedAt,
    },
    updated: saved.updatedAt,
  };

  const referenced = new Set(project.assets);
  const after = await listAssets(slug);
  for (const asset of after.assets) {
    if (!referenced.has(asset.id) && asset.refCount === 0) {
      await deleteAsset(slug, asset.id);
    }
  }

  return next;
}


export async function releases(slug: string) {
  return api<{ releases: CloudReleaseSummary[] }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/releases`,
  );
}

export async function publishRelease(
  slug: string,
  expectedDraftRevision?: number,
) {
  return api<{ release: CloudReleaseSummary & { assetCount: number } }>(
    `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/releases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "publish",
        ...(expectedDraftRevision
          ? { expectedDraftRevision }
          : {}),
      }),
    },
  );
}

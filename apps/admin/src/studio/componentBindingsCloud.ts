const CLOUD_BASE = "/3Dprojects/api/cloud";

export type ReviewedComponentSemantic =
  | "wall"
  | "door"
  | "window"
  | "opening"
  | "ignore";

export interface ReviewedComponentBindingInput {
  nodeId: string;
  floorId?: string;
  unit?: string;
  roomId?: string;
  semantic?: ReviewedComponentSemantic;
}

export interface ReviewedComponentBinding extends ReviewedComponentBindingInput {}

export interface ReviewedComponentBindingsV1 {
  format: "rekixo-reviewed-component-bindings";
  version: 1;
  processingJobId: string;
  sourcePackId: string;
  sourcePackVersion: number;
  sourcePackManifestSha256: string;
  processorVersion: string;
  outputManifestSha256: string;
  canonicalModelArtifactId: string;
  canonicalModelSha256: string;
  nodeCatalogArtifactId: string;
  nodeCatalogSha256: string;
  reviewedAgainstDraftRevision: number;
  reviewedBy: string;
  reviewedAt: string;
  bindings: ReviewedComponentBinding[];
}

export interface ReviewedComponentBindingsState {
  contractVersion: 1;
  project: {
    id: string;
    slug: string;
    name: string;
    status: "draft" | "published" | "archived";
  };
  revision: number;
  updatedAt: string;
  reviewedComponentBindings: ReviewedComponentBindingsV1 | null;
}

type ApiError = { error?: string };

function path(slug: string) {
  return `${CLOUD_BASE}/projects/${encodeURIComponent(slug)}/component-bindings`;
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
    ? ((await response.json()) as T & ApiError)
    : undefined;
  if (!response.ok)
    throw new Error(
      (body as ApiError | undefined)?.error ??
        `Reviewed component bindings request failed (${response.status}).`,
    );
  return body as T;
}

export function reviewedComponentBindings(slug: string) {
  return api<ReviewedComponentBindingsState>(path(slug));
}

export function saveReviewedComponentBindings(
  slug: string,
  expectedRevision: number,
  processingJobId: string,
  bindings: readonly ReviewedComponentBindingInput[],
) {
  return api<{
    ok: true;
    revision: number;
    updatedAt: string;
    reviewedComponentBindings: ReviewedComponentBindingsV1;
  }>(path(slug), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision, processingJobId, bindings }),
  });
}

export function clearReviewedComponentBindings(
  slug: string,
  expectedRevision: number,
) {
  return api<{
    ok: true;
    revision: number;
    updatedAt: string;
    unchanged?: boolean;
    reviewedComponentBindings?: null;
  }>(path(slug), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision }),
  });
}

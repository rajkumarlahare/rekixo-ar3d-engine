import {
  PUBLIC_BASE_PATH,
  assertBuildingPresentationManifestV1,
  assertPublic3DExperiencePayload,
  type BuildingPresentationManifestV1,
  type Public3DExperience,
} from "@rekixo/3d-contracts";
import {
  clearPublicRuntimeSiteElements,
  derivePublicSiteElementsFromStudio,
  setPublicRuntimeSiteElements,
} from "./viewer/publicRuntimeContext";
import {
  clearSemanticInteriorRuntime,
  deriveSemanticInteriorFromStudio,
  setSemanticInteriorRuntime,
  type SemanticInteriorRuntime,
} from "./viewer/semanticInteriorRuntime";

import { parseSourcePresentation, type SourcePresentation } from "./viewer/sourcePresentation";

export type ClientExperience = Public3DExperience & {
  sourcePresentation?: SourcePresentation;
  buildingPresentation?: BuildingPresentationManifestV1;
};

export class ExperienceApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ExperienceApiError";
    this.status = status;
  }
}

const OPTIONAL_METADATA_BUDGET_MS = 240;

/** Race additive metadata against a deadline without making it required. */
async function waitForOptionalMetadata<T>(
  promise: Promise<T>,
  deadline: number,
  fallback: T,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return fallback;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), remainingMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function loadPublicExperience(
  slug: string,
  signal?: AbortSignal,
): Promise<ClientExperience> {
  clearPublicRuntimeSiteElements();
  clearSemanticInteriorRuntime();
  const headers = { Accept: "application/json" };
  const projectResponsePromise = fetch(`${PUBLIC_BASE_PATH}/api/projects/${encodeURIComponent(slug)}`, {
    method: "GET",
    headers,
    signal,
    cache: "no-store",
  });
  const studioMetadataPromise = fetch(
    `${PUBLIC_BASE_PATH}/api/releases/projects/${encodeURIComponent(slug)}/studio`,
    {
      method: "GET",
      headers,
      signal,
      cache: "no-store",
    },
  ).then(async (studioResponse) => {
    if (!studioResponse.ok) return undefined;
    const studio = (await studioResponse.json()) as { project?: unknown };
    return {
      siteElements: derivePublicSiteElementsFromStudio(studio.project),
      semanticInterior: deriveSemanticInteriorFromStudio(studio.project),
    };
  }).catch(() => {
    // Studio geometry is additive; a malformed optional response must not disable the published model.
    return undefined;
  });
  const response = await projectResponsePromise;

  if (!response.ok) {
    let message = `Could not load 3D project (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the stable fallback message.
    }
    throw new ExperienceApiError(message, response.status);
  }

  const body = (await response.json()) as Record<string, unknown>;
  // Studio enrichment and recovered source presentation are optional. Allow
  // them a short shared grace period, but never let either delay the source GLB
  // request indefinitely when an auxiliary endpoint is slow.
  const optionalMetadataDeadline = Date.now() + OPTIONAL_METADATA_BUDGET_MS;
  const studioMetadata = await waitForOptionalMetadata(
    studioMetadataPromise,
    optionalMetadataDeadline,
    undefined,
  );
  const siteElements = studioMetadata?.siteElements ?? [];
  const semanticInterior: SemanticInteriorRuntime | undefined =
    studioMetadata?.semanticInterior;

  const enriched = siteElements?.length ? { ...body, siteElements } : body;
  try {
    assertPublic3DExperiencePayload(enriched);
    if (body.buildingPresentation !== undefined)
      assertBuildingPresentationManifestV1(body.buildingPresentation);
  } catch (error) {
    clearPublicRuntimeSiteElements();
    clearSemanticInteriorRuntime();
    throw new ExperienceApiError(
      error instanceof Error
        ? `3D project response is corrupted: ${error.message}`
        : "3D project response is corrupted.",
      502,
    );
  }

  const release = body.release as { manifestSha256?: string } | undefined;
  const model = body.model as { id?: string } | undefined;
  let sourcePresentation: SourcePresentation | undefined;
  if (
    release?.manifestSha256 &&
    /^[a-f0-9]{64}$/.test(release.manifestSha256) &&
    model?.id &&
    Date.now() < optionalMetadataDeadline
  ) {
    const presentationPromise = fetch(
      `${PUBLIC_BASE_PATH}/presentations/${release.manifestSha256}/manifest.json`,
      { signal, cache: "no-cache" },
    ).then(async (presentationResponse) => {
      if (
        !presentationResponse.ok ||
        !presentationResponse.headers.get("content-type")?.includes("application/json")
      ) return undefined;
      return parseSourcePresentation(
        await presentationResponse.json(),
        release.manifestSha256!,
        model.id!,
      );
    }).catch(() => undefined);
    sourcePresentation = await waitForOptionalMetadata(
      presentationPromise,
      optionalMetadataDeadline,
      undefined,
    );
  }
  setPublicRuntimeSiteElements(siteElements ?? []);
  setSemanticInteriorRuntime(semanticInterior);
  return { ...enriched, sourcePresentation } as unknown as ClientExperience;
}
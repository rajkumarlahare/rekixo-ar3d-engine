import {
  PUBLIC_BASE_PATH,
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

export async function loadPublicExperience(
  slug: string,
  signal?: AbortSignal,
): Promise<ClientExperience> {
  clearPublicRuntimeSiteElements();
  clearSemanticInteriorRuntime();
  const headers = { Accept: "application/json" };
  const [response, studioResponse] = await Promise.all([
    fetch(`${PUBLIC_BASE_PATH}/api/projects/${encodeURIComponent(slug)}`, {
      method: "GET",
      headers,
      signal,
      cache: "no-store",
    }),
    fetch(
      `${PUBLIC_BASE_PATH}/api/releases/projects/${encodeURIComponent(slug)}/studio`,
      {
        method: "GET",
        headers,
        signal,
        cache: "no-store",
      },
    ).catch(() => undefined),
  ]);

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
  let siteElements = [] as Public3DExperience["siteElements"];
  let semanticInterior: SemanticInteriorRuntime | undefined;
  if (studioResponse?.ok) {
    try {
      const studio = (await studioResponse.json()) as { project?: unknown };
      siteElements = derivePublicSiteElementsFromStudio(studio.project);
      semanticInterior = deriveSemanticInteriorFromStudio(studio.project);
    } catch {
      // Reviewed Studio geometry is additive. A malformed optional Studio
      // response must not take an otherwise valid published building offline.
      siteElements = [];
      semanticInterior = undefined;
    }
  }

  const enriched = siteElements?.length ? { ...body, siteElements } : body;
  try {
    assertPublic3DExperiencePayload(enriched);
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
  if (release?.manifestSha256 && /^[a-f0-9]{64}$/.test(release.manifestSha256) && model?.id) {
    try {
      const response = await fetch(`${PUBLIC_BASE_PATH}/presentations/${release.manifestSha256}/manifest.json`, { signal, cache: "no-cache" });
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) sourcePresentation = parseSourcePresentation(await response.json(), release.manifestSha256, model.id);
    } catch { /* Presentation assets never block an otherwise valid published model. */ }
  }
  setPublicRuntimeSiteElements(siteElements ?? []);
  setSemanticInteriorRuntime(semanticInterior);
  return { ...enriched, sourcePresentation } as unknown as ClientExperience;
}
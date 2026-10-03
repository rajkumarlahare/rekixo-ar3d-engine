import {
  PUBLIC_BASE_PATH,
  assertPublic3DExperiencePayload,
  type Public3DExperience,
} from "@rekixo/3d-contracts";
import {
  clearPublicRuntimeSiteElements,
  derivePublicSiteElementsFromStudio,
  setPublicRuntimeSiteElements,
} from "./viewer/publicRuntimeContext";

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
): Promise<Public3DExperience> {
  clearPublicRuntimeSiteElements();
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
  if (studioResponse?.ok) {
    try {
      const studio = (await studioResponse.json()) as { project?: unknown };
      siteElements = derivePublicSiteElementsFromStudio(studio.project);
    } catch {
      // Site/landscape is additive. A malformed optional Studio response must
      // not take an otherwise valid published building offline.
      siteElements = [];
    }
  }

  const enriched = siteElements?.length
    ? { ...body, siteElements }
    : body;
  try {
    assertPublic3DExperiencePayload(enriched);
  } catch (error) {
    clearPublicRuntimeSiteElements();
    throw new ExperienceApiError(
      error instanceof Error
        ? `3D project response is corrupted: ${error.message}`
        : "3D project response is corrupted.",
      502,
    );
  }

  setPublicRuntimeSiteElements(siteElements ?? []);
  return enriched as unknown as Public3DExperience;
}

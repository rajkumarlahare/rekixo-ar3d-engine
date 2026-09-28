import {
  PUBLIC_BASE_PATH,
  assertPublic3DExperiencePayload,
  type Public3DExperience,
} from "@rekixo/3d-contracts";

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
  const response = await fetch(
    `${PUBLIC_BASE_PATH}/api/projects/${encodeURIComponent(slug)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
      cache: "no-store",
    },
  );

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

  const body = await response.json();
  try {
    assertPublic3DExperiencePayload(body);
  } catch (error) {
    throw new ExperienceApiError(
      error instanceof Error
        ? `3D project response is corrupted: ${error.message}`
        : "3D project response is corrupted.",
      502,
    );
  }
  return body as Public3DExperience;
}

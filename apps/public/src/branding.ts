import { PUBLIC_BASE_PATH } from "@rekixo/3d-contracts";

export type PublicBrandingExperience = "building" | "geo";

export interface PublicProjectBranding {
  project: { id: string; slug: string; name: string; location?: string };
  experience: PublicBrandingExperience;
  title: string;
  description: string;
  logoUrl: string;
  faviconUrl: string;
  shareImageUrl: string;
  shareVersion: string;
}

export async function loadPublicBranding(
  slug: string,
  experience: PublicBrandingExperience,
  signal?: AbortSignal,
): Promise<PublicProjectBranding | null> {
  try {
    const query = new URLSearchParams({ experience });
    const response = await fetch(
      `${PUBLIC_BASE_PATH}/api/projects/${encodeURIComponent(slug)}/branding?${query}`,
      { headers: { Accept: "application/json" }, cache: "no-store", signal },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as PublicProjectBranding;
    if (
      data.experience !== experience ||
      data.project?.slug !== slug ||
      typeof data.title !== "string" ||
      typeof data.description !== "string"
    ) return null;
    return data;
  } catch {
    // Branding must remain additive: an unavailable optional branding API cannot
    // block an otherwise valid immutable Building/Geo release.
    return null;
  }
}

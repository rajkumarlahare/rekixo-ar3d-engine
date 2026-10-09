import { PUBLIC_BASE_PATH } from "@rekixo/3d-contracts";
import {
  normalizeProjectSlug,
  validProjectSlug,
} from "../../../shared/project-slug-policy.js";

export {
  RESERVED_PROJECT_SLUGS,
  normalizeProjectSlug,
  validProjectSlug,
} from "../../../shared/project-slug-policy.js";

export function projectSlugFromPathname(pathname: string) {
  const prefix = `${PUBLIC_BASE_PATH}/`;
  if (!pathname.startsWith(prefix)) return "";
  const segment = pathname.slice(prefix.length).split("/")[0] || "";
  try {
    const slug = normalizeProjectSlug(decodeURIComponent(segment));
    return validProjectSlug(slug) ? slug : "";
  } catch {
    return "";
  }
}

export const BUILDING_EXPERIENCE_TYPE = "building" as const;
export const GEO_EXPERIENCE_TYPE = "geo" as const;

/**
 * Public customer-facing origin. Admin and Public apps use the same route
 * prefix on different hostnames, so relative paths would reopen the Admin app.
 */
export const PUBLIC_PROJECT_ORIGIN = "https://ar3dstudio.in";

export function buildingPublicProjectPath(slug: string) {
  const normalized = normalizeProjectSlug(slug);
  if (!validProjectSlug(normalized)) throw new Error("Invalid 3D project slug.");
  return `${PUBLIC_PROJECT_ORIGIN}${PUBLIC_BASE_PATH}/${encodeURIComponent(normalized)}`;
}

/**
 * Backward-compatible canonical Building Experience URL helper.
 *
 * Building remains the default public deliverable for every Engine project.
 * Keep this alias stable so existing callers and customer URLs do not change
 * while optional experiences (such as Geo) evolve independently.
 */
export function publicProjectPath(slug: string) {
  return buildingPublicProjectPath(slug);
}

export function geoPublicProjectPath(slug: string) {
  return `${buildingPublicProjectPath(slug)}/geo`;
}

export function projectAssetPrefix(slug: string) {
  const normalized = normalizeProjectSlug(slug);
  if (!validProjectSlug(normalized)) throw new Error("Invalid 3D project slug.");
  return `projects/${normalized}`;
}

export function recommendedExteriorModelKey(slug: string, version = 1) {
  if (!Number.isInteger(version) || version < 1) throw new Error("Invalid model version.");
  return `${projectAssetPrefix(slug)}/models/exterior-v${version}.glb`;
}

export * from "./editor";
export * from "./geo-rigid-placement";
export * from "./geo-guided-rigid-alignment";

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

export function publicProjectPath(slug: string) {
  const normalized = normalizeProjectSlug(slug);
  if (!validProjectSlug(normalized)) throw new Error("Invalid 3D project slug.");
  return `${PUBLIC_BASE_PATH}/${encodeURIComponent(normalized)}`;
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

export const RESERVED_PROJECT_SLUGS = Object.freeze([
  "api",
  "assets",
  "studio",
  "login",
  "showcase",
  "published",
]);

const RESERVED = new Set(RESERVED_PROJECT_SLUGS);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeProjectSlug(value) {
  return String(value || "").trim().toLowerCase();
}

export function validProjectSlug(value) {
  const slug = normalizeProjectSlug(value);
  return (
    slug.length >= 2 &&
    slug.length <= 80 &&
    SLUG_PATTERN.test(slug) &&
    !RESERVED.has(slug)
  );
}

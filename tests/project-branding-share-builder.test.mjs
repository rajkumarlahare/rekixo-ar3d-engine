import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../database/migrations/0038_project_branding_share_builder_v1.sql", import.meta.url),
  "utf8",
);
const worker = await readFile(
  new URL("../workers/project-branding.mjs", import.meta.url),
  "utf8",
);
const adminCloud = await readFile(
  new URL("../workers/admin-cloud.mjs", import.meta.url),
  "utf8",
);
const publicWorker = await readFile(
  new URL("../workers/public.mjs", import.meta.url),
  "utf8",
);
const builder = await readFile(
  new URL("../apps/admin/src/branding/ProjectShareBuilder.tsx", import.meta.url),
  "utf8",
);
const cloudClient = await readFile(
  new URL("../apps/admin/src/studio/cloud.ts", import.meta.url),
  "utf8",
);
const adminRouter = await readFile(
  new URL("../apps/admin/src/main.tsx", import.meta.url),
  "utf8",
);
const adminShell = await readFile(
  new URL("../apps/admin/src/layout/EngineAdminShell.tsx", import.meta.url),
  "utf8",
);
const publicApp = await readFile(
  new URL("../apps/public/src/main.tsx", import.meta.url),
  "utf8",
);
const geoApp = await readFile(
  new URL("../apps/public/src/geo/GeoPublicDemo.tsx", import.meta.url),
  "utf8",
);

test("branding schema is additive, project scoped, and keeps immutable history", () => {
  for (const table of [
    "project_branding_3d",
    "project_branding_logo_versions_3d",
    "project_branding_shares_3d",
    "project_branding_share_versions_3d",
  ]) assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /experience_type IN \('building','geo'\)/);
  assert.ok(migration.includes("PRIMARY KEY (project_id, experience_type, version)"));
  assert.ok(migration.includes("project branding share versions are immutable"));
  assert.ok(migration.includes("ON DELETE CASCADE"));
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM projects_3d/i);
});

test("branding uploads are authenticated, format checked, and stored in project-owned R2 prefixes", () => {
  assert.ok(adminCloud.includes('parts[1] === "branding"'));
  assert.ok(worker.includes("if (!(await sameOrigin(request)))"));
  assert.ok(worker.includes("detectImageMime"));
  assert.ok(worker.includes("MAX_LOGO_BYTES = 512 * 1024"));
  assert.ok(worker.includes("MAX_FAVICON_BYTES = 128 * 1024"));
  assert.ok(worker.includes("MAX_SOURCE_CARD_BYTES = 8 * 1024 * 1024"));
  assert.ok(worker.includes("MAX_PUBLIC_CARD_BYTES = 550 * 1024"));
  assert.ok(worker.includes(`projects/${slug}/branding/logos/${version}.webp`));
  assert.ok(worker.includes(`projects/${slug}/branding/favicons/${version}.png`));
  assert.ok(worker.includes(`projects/${slug}/branding/share/${experience}/cards/${version}`));
  assert.ok(worker.includes("key.startsWith(prefix)"));
});

test("Building and Geo share snapshots publish independently and require live releases", () => {
  assert.ok(worker.includes('const EXPERIENCE_TYPES = new Set(["building", "geo"])'));
  assert.ok(worker.includes('experienceReadiness(env, project, slug, experience)'));
  assert.ok(worker.includes("activeGeoReleaseState(env, slug)"));
  assert.ok(worker.includes("activeReleaseState(env, slug)"));
  assert.ok(worker.includes("project_branding_share_versions_3d"));
  assert.ok(worker.includes("published_version"));
  assert.ok(worker.includes("shareUrl"));
  assert.ok(builder.includes('setActiveExperience("building")'));
  assert.ok(builder.includes('setActiveExperience("geo")'));
  assert.ok(builder.includes("Publish Share"));
  assert.ok(builder.includes("Copy published link"));
});

test("public Worker returns project-scoped immutable assets and crawler-readable Building/Geo metadata", () => {
  assert.ok(publicWorker.includes("servePublicBrandingRoute"));
  assert.ok(publicWorker.includes("injectPublicBrandingMetadata"));
  assert.ok(worker.includes('og:title'));
  assert.ok(worker.includes('og:description'));
  assert.ok(worker.includes('og:image'));
  assert.ok(worker.includes('twitter:card'));
  assert.ok(worker.includes('rel="icon"'));
  assert.ok(worker.includes('shareVersion'));
  assert.ok(worker.includes("public, max-age=31536000, immutable"));
});

test("Admin route and public Building/Geo viewers use one project logo without replacing Engine admin branding", () => {
  assert.ok(adminRouter.includes('path === "/3Dprojects/share"'));
  assert.ok(adminShell.includes('label: "Share & Branding"'));
  assert.ok(cloudClient.includes("uploadProjectLogo"));
  assert.ok(cloudClient.includes("uploadProjectShareCard"));
  assert.ok(builder.includes("Publish Logo & Favicon"));
  assert.ok(builder.includes("AR3D footer added"));
  assert.ok(publicApp.includes("loadPublicBranding(slug, \"building\""));
  assert.ok(publicApp.includes("brand-project-logo"));
  assert.ok(geoApp.includes('loadPublicBranding(slug, "geo"'));
  assert.ok(geoApp.includes("jio-public-project-logo"));
});

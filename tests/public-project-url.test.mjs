import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_PROJECT_ORIGIN,
  buildingPublicProjectPath,
  geoPublicProjectPath,
  publicProjectPath,
} from "../packages/engine-core/src/index.ts";

test("Building live URL uses the canonical public origin and encoded project slug", () => {
  assert.equal(
    buildingPublicProjectPath("garden-heights"),
    "https://ar3dstudio.in/3Dprojects/garden-heights",
  );
  assert.equal(
    publicProjectPath("garden-heights"),
    "https://ar3dstudio.in/3Dprojects/garden-heights",
  );
  assert.equal(PUBLIC_PROJECT_ORIGIN, "https://ar3dstudio.in");
});

test("Geo live URL is the public Building URL with the Geo route suffix", () => {
  assert.equal(
    geoPublicProjectPath("garden-heights"),
    "https://ar3dstudio.in/3Dprojects/garden-heights/geo",
  );
});

test("live URL helpers continue rejecting reserved or invalid project slugs", () => {
  assert.throws(() => buildingPublicProjectPath(""), /Invalid 3D project slug/);
  assert.throws(() => buildingPublicProjectPath("api"), /Invalid 3D project slug/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const admin = fs.readFileSync("apps/admin/src/geo/GeoIntegratedAuthoringMap.tsx", "utf8");
const publicGeo = fs.readFileSync("apps/public/src/geo/GeoPublicDemo.tsx", "utf8");

test("Geo V2 WebGL overlays implement the lifecycle Google requires to render", () => {
  for (const source of [admin, publicGeo]) {
    assert.match(source, /overlay\.onAdd\s*=\s*\(\)\s*=>/);
    assert.match(source, /overlay\.onContextRestored\s*=/);
    assert.match(source, /overlay\.onDraw\s*=/);
    assert.match(source, /overlay\.onContextLost\s*=/);
    assert.match(source, /overlay\.onRemove\s*=/);
    assert.match(source, /gl\.getContextAttributes\(\)/);
    assert.match(source, /getMapCapabilities/);
    assert.match(source, /isWebGLOverlayViewAvailable/);
  }
});

test("Admin integrated Building authoring fails closed without the production vector Map ID", () => {
  assert.match(admin, /!apiKey \|\| !configuredMapId \|\| !hostRef\.current/);
  assert.match(admin, /mapId:\s*configuredMapId/);
  assert.match(admin, /Production JavaScript Vector Map ID save karein/);
  assert.doesNotMatch(admin, /DEMO_MAP_ID/);
});

test("Public integrated Geo remains pinned to the configured production Map ID", () => {
  assert.match(publicGeo, /mapId:\s*data\.maps\.mapId/);
  assert.match(publicGeo, /data\.maps\.configured && data\.maps\.apiKey && data\.maps\.mapId/);
  assert.doesNotMatch(publicGeo, /DEMO_MAP_ID/);
});

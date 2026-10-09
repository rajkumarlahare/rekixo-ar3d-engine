import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
};

const slugPolicyJs = fs.readFileSync(
  new URL("../shared/project-slug-policy.js", import.meta.url),
  "utf8",
);
const slugPolicyUrl =
  "data:text/javascript;base64," + Buffer.from(slugPolicyJs).toString("base64");

const contractsShim = 'export const PUBLIC_BASE_PATH = "/3Dprojects";';
const contractsUrl =
  "data:text/javascript;base64," + Buffer.from(contractsShim).toString("base64");

const source = fs.readFileSync(
  new URL("../packages/engine-core/src/index.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions,
}).outputText
  .replace(
    /from ["']@rekixo\/3d-contracts["'];/,
    `from ${JSON.stringify(contractsUrl)};`,
  )
  .replace(
    /from ["']\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js["'];/g,
    `from ${JSON.stringify(slugPolicyUrl)};`,
  )
  .replace(/export \* from ["']\.\/editor["'];/g, "")
  .replace(/export \* from ["']\.\/geo-rigid-placement["'];/g, "")
  .replace(/export \* from ["']\.\/geo-guided-rigid-alignment["'];/g, "");

const engineCoreUrl =
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64");
const {
  PUBLIC_PROJECT_ORIGIN,
  buildingPublicProjectPath,
  geoPublicProjectPath,
  publicProjectPath,
} = await import(engineCoreUrl);

test("Building live URL uses the canonical public origin and project slug", () => {
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

test("live URL helpers reject invalid and reserved project slugs", () => {
  assert.throws(() => buildingPublicProjectPath(""), /Invalid 3D project slug/);
  assert.throws(() => buildingPublicProjectPath("api"), /Invalid 3D project slug/);
});

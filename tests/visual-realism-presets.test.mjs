import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");
const compile = (path) => ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const slugPolicyUrl = url(read("shared/project-slug-policy.js"));
const domainCode = compile("apps/admin/src/studio/domain.ts").replace(/(["'])\.\.\/\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js\1/, JSON.stringify(slugPolicyUrl));
const domainUrl = url(domainCode);
const domain = await import(domainUrl);
const presetCode = compile("apps/admin/src/studio/appearancePresets.ts").replace(/(["'])\.\/domain\1/, JSON.stringify(domainUrl));
const presets = await import(url(presetCode));

test("realism presets are four named, valid SceneAppearance configurations", () => {
  assert.deepEqual(presets.APPEARANCE_PRESETS.map((preset) => preset.id), ["reference-match", "clean-day", "warm-evening", "night-lights"]);
  assert.deepEqual(presets.APPEARANCE_PRESETS.map((preset) => preset.label), ["Reference Match", "Clean Day", "Warm Evening", "Night Lights"]);
  for (const preset of presets.APPEARANCE_PRESETS) {
    const project = domain.newProject(`Preset ${preset.label}`);
    project.scene.appearance = { ...preset.appearance };
    assert.doesNotThrow(() => domain.validateProject(project));
    assert.equal(presets.activeAppearancePreset(project.scene.appearance)?.id, preset.id);
  }
});

test("reference match is the canonical default and manual tuning becomes Custom", () => {
  const reference = presets.appearancePreset("reference-match");
  assert.deepEqual(reference.appearance, domain.DEFAULT_SCENE_APPEARANCE);
  assert.equal(reference.appearance.referenceVisual, true);
  assert.equal(reference.appearance.nightMode, false);
  const clean = presets.appearancePreset("clean-day");
  assert.equal(clean.appearance.referenceVisual, false);
  assert.equal(clean.appearance.nightMode, false);
  assert.equal(presets.activeAppearancePreset({ ...clean.appearance, exposure: clean.appearance.exposure + 0.05 }), undefined);
});

test("evening presets use architectural lights with distinct light balances", () => {
  const warm = presets.appearancePreset("warm-evening").appearance;
  const night = presets.appearancePreset("night-lights").appearance;
  assert.equal(warm.nightMode, true);
  assert.equal(night.nightMode, true);
  assert.ok(warm.sunIntensity > night.sunIntensity);
  assert.ok(warm.hemisphereIntensity > night.hemisphereIntensity);
  assert.ok(warm.exposure >= night.exposure);
});

test("retained presentation canvas applies scene appearance controls", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const appearance = read("apps/admin/src/studio/sceneCanvasAppearance.ts");
  assert.match(canvas, /applySceneCanvasAppearance/);
  for (const property of ["toneMappingExposure", "hemisphereIntensity", "sunIntensity", "nightMode"])
    assert.match(appearance, new RegExp(property));
});

test("new projects receive a cloned default appearance rather than shared mutable state", () => {
  const left = domain.newProject("Left");
  const right = domain.newProject("Right");
  assert.deepEqual(left.scene.appearance, domain.DEFAULT_SCENE_APPEARANCE);
  assert.deepEqual(right.scene.appearance, domain.DEFAULT_SCENE_APPEARANCE);
  assert.notEqual(left.scene.appearance, right.scene.appearance);
  left.scene.appearance.exposure = 1.7;
  assert.equal(right.scene.appearance.exposure, 1);
  assert.equal(domain.DEFAULT_SCENE_APPEARANCE.exposure, 1);
});

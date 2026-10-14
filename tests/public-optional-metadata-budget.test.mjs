import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = fs.readFileSync("apps/public/src/api.ts", "utf8");

test("public Building launch does not join the required project request to optional Studio metadata", () => {
  assert.match(api, /const projectResponsePromise = fetch\([\s\S]*?\/api\/projects\//);
  assert.match(api, /const studioMetadataPromise = fetch\([\s\S]*?\/studio/);
  assert.match(api, /const response = await projectResponsePromise/);
  assert.doesNotMatch(api, /const \[response, studioResponse\] = await Promise\.all/);
});

test("optional Studio and source-presentation metadata share a bounded launch wait", () => {
  assert.match(api, /OPTIONAL_METADATA_BUDGET_MS = 240/);
  assert.match(api, /function waitForOptionalMetadata/);
  assert.match(api, /Promise\.race\(\[promise, timeout\]\)/);
  assert.match(api, /waitForOptionalMetadata\(\s*studioMetadataPromise/);
  assert.match(api, /waitForOptionalMetadata\(\s*presentationPromise/);
  assert.match(api, /optionalMetadataDeadline = Date\.now\(\) \+ OPTIONAL_METADATA_BUDGET_MS/);
});

test("Studio and source-presentation lookup start before their shared bounded wait", () => {
  assert.match(api, /let presentationPromise: Promise<SourcePresentation \| undefined> = Promise\.resolve\(undefined\)/);
  assert.match(api, /const \[studioMetadata, sourcePresentation\] = await Promise\.all\(\[/);
  assert.ok(
    api.indexOf("let presentationPromise") < api.indexOf("const [studioMetadata, sourcePresentation] = await Promise.all"),
    "presentation lookup must be configured before the shared wait starts",
  );
  assert.doesNotMatch(api, /Date\.now\(\) < optionalMetadataDeadline/);
});

test("the optional metadata budget preserves immutable source-presentation validation", () => {
  assert.match(api, /release\?\.manifestSha256/);
  assert.match(api, /parseSourcePresentation\([\s\S]*?release\.manifestSha256!,[\s\S]*?model\.id!/);
  assert.match(api, /headers\.get\("content-type"\).*application\/json/);
  assert.match(api, /return \{ \.\.\.enriched, sourcePresentation \}/);
  assert.match(api, /assertPublic3DExperiencePayload\(enriched\)/);
});

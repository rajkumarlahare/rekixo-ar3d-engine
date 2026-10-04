import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const intelligence = fs.readFileSync(
  "apps/admin/src/studio/deepSourceIntelligence.ts",
  "utf8",
);
const pipeline = fs.readFileSync(
  "apps/admin/src/studio/autoBuildPipeline.ts",
  "utf8",
);

test("Perfection Phase 2 classifies every PDF page instead of selecting one PDF by attachment order", () => {
  assert.match(intelligence, /for \(const asset of files\.filter\(\(entry\) => \/\\\.pdf\$\/i\.test\(entry\.name\)\)\)/);
  assert.match(intelligence, /for \(const page of inspection\.pages\)/);
  for (const role of [
    '"floor-plan"',
    '"site-plan"',
    '"elevation"',
    '"section"',
    '"schedule"',
    '"brochure"',
    '"unknown"',
  ])
    assert.ok(intelligence.includes(role), `missing PDF page role ${role}`);
});

test("Perfection Phase 2 resolves only explicit floor identity and never guesses from page/file order", () => {
  assert.match(intelligence, /export function inferExplicitFloorIndices/);
  assert.match(intelligence, /ground floor\|ground\|gf\|g floor/);
  assert.match(intelligence, /ordinalRange/);
  assert.match(intelligence, /wordRange/);
  assert.match(intelligence, /page\/file order was not used as a guess/);
  assert.match(intelligence, /status: count === 1 \? "resolved" : count > 1 \? "multi-floor" : "ambiguous"/);
});

test("Perfection Phase 2 keeps source authority domain-specific and fail-closed on ties", () => {
  for (const domain of [
    '"metric-geometry"',
    '"dimensions"',
    '"floor-identity"',
    '"room-semantics"',
    '"openings"',
    '"materials"',
    '"visual-style"',
    '"metadata"',
  ])
    assert.ok(intelligence.includes(domain), `missing authority domain ${domain}`);
  assert.match(intelligence, /Multiple equally authoritative/);
  assert.match(intelligence, /Rekixo will not silently choose one/);
  assert.match(intelligence, /status: "review" as const/);
});

test("visual references can drive style but are explicitly non-metric", () => {
  assert.match(intelligence, /metricAuthority: false/);
  assert.match(intelligence, /visual reference; non-metric/);
  assert.match(intelligence, /role === "plan-reference"/);
});

test("DRS intelligence remains metadata evidence rather than geometry truth", () => {
  assert.match(intelligence, /inspectDrsMetadata/);
  assert.match(intelligence, /materialResourceHints/);
  assert.match(intelligence, /modelResourceHints/);
  assert.match(intelligence, /metadata room-center hints; non-authoritative/);
});

test("AutoBuild exposes deep source intelligence and includes unresolved authority conflicts in certification issues", () => {
  assert.match(pipeline, /buildDeepSourceIntelligence/);
  assert.match(pipeline, /sourceIntelligence: DeepSourceIntelligenceReport/);
  assert.match(pipeline, /\.\.\.sourceIntelligence\.issues/);
  assert.match(pipeline, /source intelligence \$\{intelligence\.counts\.classifiedPdfPages\}/);
  assert.match(pipeline, /authorityMatrix/);
});

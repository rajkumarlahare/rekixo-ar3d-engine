import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 7 Studio exposes operations-first project navigation", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  for (const label of [
    "Overview",
    "3D Editor",
    "Sources",
    "Evidence",
    "Preview & Publish",
  ])
    assert.match(studio, new RegExp(label.replace(/[&]/g, "\\&")));
  assert.match(studio, /aria-label="Search 3D projects"/);
  assert.match(studio, /aria-label="Selected local project"/);
  assert.match(studio, /aria-label="Selected cloud project"/);
  assert.match(studio, /\+ New project/);
  assert.match(studio, /workspace === "editor"/);
  assert.match(studio, /StudioOverview/);
  assert.match(studio, /StudioSources/);
  assert.match(studio, /StudioEvidence/);
  assert.match(studio, /StudioPublish/);
});

test("publish readiness is an explicit gate rather than a cosmetic status", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const readiness = read("apps/admin/src/studio/readiness.ts");
  assert.match(studio, /Publish blocked:/);
  assert.match(studio, /!readiness\.publishable/);
  assert.match(readiness, /Engine Admin cloud session required/);
  assert.match(readiness, /Cloud draft not created/);
  assert.match(readiness, /Unsaved draft changes/);
  assert.match(readiness, /Web publish model must be self-contained GLB/);
  assert.match(readiness, /Source model retained for authoring/);
  assert.match(readiness, /No publishable 3D content/);
});

test("source intake distinguishes publish model from evidence files", () => {
  const source = read("apps/admin/src/studio/StudioSources.tsx");
  assert.match(source, /PUBLISH MODEL/);
  assert.match(source, /SOURCE LIBRARY/);
  assert.match(source, /SOURCE MODEL/);
  assert.match(source, /WEB READY/);
  assert.match(source, /self-contained GLB/i);
  assert.match(source, /SHA-256/);
  assert.match(source, /DWG\/DXF\/PDF\/SKP\/SKB\/DRS\/images\/CSV/);
});

test("evidence workspace keeps reviewed and unverified room provenance visible", () => {
  const evidence = read("apps/admin/src/studio/StudioEvidence.tsx");
  assert.match(evidence, /Measurement provenance/);
  assert.match(evidence, /REVIEWED/);
  assert.match(evidence, /UNVERIFIED/);
  assert.match(evidence, /sourcePackSourceId/);
  assert.match(evidence, /sourceClaimIds/);
  assert.match(evidence, /No source/);
});

test("preview and publish workspace supports readiness, previews and rollback", () => {
  const publish = read("apps/admin/src/studio/StudioPublish.tsx");
  assert.match(publish, /Publish immutable release/);
  assert.match(publish, /Save to cloud/);
  assert.match(publish, /Public runtime/);
  assert.match(publish, /Published Studio showcase/);
  assert.match(publish, /RELEASE HISTORY/);
  assert.match(publish, /Activate v/);
  assert.match(publish, /current draft will not be changed/i);
});

test("operations UI is responsive on desktop, tablet, mobile and short landscape", () => {
  const css = read("apps/admin/src/studio/studio-operations.css");
  assert.match(css, /grid-template-columns: repeat\(6,/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(
    css,
    /@media \(max-height: 560px\) and \(orientation: landscape\)/,
  );
});

test("Phase 7 stays Engine-owned and has no sibling Platform runtime dependency", () => {
  const files = [
    "apps/admin/src/studio/Studio.tsx",
    "apps/admin/src/studio/StudioOverview.tsx",
    "apps/admin/src/studio/StudioSources.tsx",
    "apps/admin/src/studio/StudioEvidence.tsx",
    "apps/admin/src/studio/StudioPublish.tsx",
    "apps/admin/src/studio/readiness.ts",
  ];
  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /rekixo-ar3d-platform/);
    assert.doesNotMatch(source, /tiyansh_admin/);
    assert.doesNotMatch(source, /\/api\/admin\//);
  }
});

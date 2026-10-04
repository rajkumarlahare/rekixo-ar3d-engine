import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync("apps/public/index.html", "utf8");
const runtime = fs.readFileSync("apps/public/src/demo-performance.ts", "utf8");
const css = fs.readFileSync("apps/public/src/performance-polish.css", "utf8");

test("public demo wires phase 7 performance polish", () => {
  assert.match(index, /performance-polish\.css/);
  assert.match(index, /demo-performance\.ts/);
});

test("runtime detects constrained devices without changing 3D source semantics", () => {
  assert.match(runtime, /deviceMemory/);
  assert.match(runtime, /hardwareConcurrency/);
  assert.match(runtime, /saveData/);
  assert.match(runtime, /prefers-reduced-motion/);
  assert.match(runtime, /demo-low-power/);
  assert.match(runtime, /viewer-loader/);
  assert.match(runtime, /viewer-notice/);
  assert.doesNotMatch(runtime, /reconstruct|inferRoom|replaceModel|modelUrl\s*=/i);
});

test("low-power and responsive polish reduce UI cost while preserving usability", () => {
  assert.match(css, /\.demo-low-power/);
  assert.match(css, /backdrop-filter:\s*none\s*!important/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /orientation: landscape/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:\s*52px/);
  assert.match(css, /viewer-loader-track/);
});

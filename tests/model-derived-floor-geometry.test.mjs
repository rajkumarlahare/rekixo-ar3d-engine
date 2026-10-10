import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../apps/public/src/viewer/floorGeometry.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpile(source, {
  module: ts.ModuleKind.ES2022,
  target: ts.ScriptTarget.ES2022,
});
const floorGeometryModule = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);
const { deriveFloorGeometryFromModel, resolveFloorGeometry } = floorGeometryModule;

const modelBounds = {
  minX: 0,
  minY: 0,
  minZ: -27.5577864884,
  maxX: 26.0721642923,
  maxY: 20.8534000000,
  maxZ: 0,
};
const repeatedFootprint = {
  minX: 6.2291105344,
  maxX: 21.9061689429,
  minZ: -23.2059182048,
  maxZ: -2.9837426607,
};
const meshBounds = [
  {
    minX: 2.081,
    maxX: 24.5482,
    minY: 0.3048,
    maxY: 3.048,
    minZ: -25.9488,
    maxZ: -0.0369,
  },
  ...[
    [3.048, 6.0452],
    [6.0452, 9.0424],
    [9.0424, 12.0396],
    [12.0396, 15.0368],
  ].map(([minY, maxY]) => ({ ...repeatedFootprint, minY, maxY })),
  {
    minX: 6.2291105344,
    maxX: 21.9061689429,
    minY: 15.2908,
    maxY: 18.034,
    minZ: -23.2059182048,
    maxZ: -9.8693538499,
  },
];

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= 1e-4, `${message}: got ${actual}, expected ${expected}`);
}

test("source mesh measurements produce measured floor bands and a separate roof band", () => {
  const result = deriveFloorGeometryFromModel({ modelBounds, meshBounds });

  assert.equal(result.floors.length, 6);
  const expected = [
    [0, 0.3048, 3.048],
    [1, 3.048, 6.0452],
    [2, 6.0452, 9.0424],
    [3, 9.0424, 12.0396],
    [4, 12.0396, 15.0368],
    [5, 15.0368, 18.034],
  ];
  for (const [index, [floor, bottom, top]] of expected.entries()) {
    assert.equal(result.floors[index].floor, floor);
    close(result.floors[index].elevationM, bottom, `floor ${floor} bottom`);
    close(result.floors[index].topElevationM, top, `floor ${floor} top`);
    assert.equal(result.floors[index].source, "model");
  }

  assert.ok(result.roof, "source mesh bounds should expose an isolated roof band");
  close(result.roof.elevationM, 18.034, "roof bottom");
  close(result.roof.topElevationM, 20.8534, "roof top");
});

test("a GLB without a repeated vertical mesh stack fails closed instead of inventing cuts", () => {
  const result = deriveFloorGeometryFromModel({
    modelBounds,
    meshBounds: [{
      minX: modelBounds.minX,
      minY: modelBounds.minY,
      minZ: modelBounds.minZ,
      maxX: modelBounds.maxX,
      maxY: modelBounds.maxY,
      maxZ: modelBounds.maxZ,
    }],
  });
  assert.deepEqual(result, { floors: [] });
});

test("missing source elevations no longer split the whole model into equal bands", () => {
  assert.deepEqual(resolveFloorGeometry({
    floorIds: [0, 1, 2, 3, 4, 5],
    minY: modelBounds.minY,
    maxY: modelBounds.maxY,
  }), []);
});

test("model-derived bands respect a compatible configured floor ID list and reject a mismatch", () => {
  const compatible = deriveFloorGeometryFromModel({
    modelBounds, meshBounds, floorIds: [0, 1, 2, 3, 4, 5],
  });
  assert.deepEqual(compatible.floors.map((item) => item.floor), [0, 1, 2, 3, 4, 5]);

  const mismatched = deriveFloorGeometryFromModel({
    modelBounds, meshBounds, floorIds: [0, 1, 2, 3, 4],
  });
  assert.deepEqual(mismatched, { floors: [] });
});

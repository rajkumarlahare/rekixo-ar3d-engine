import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  NODE_CATALOG_FORMAT,
  NODE_CATALOG_VERSION,
  buildNodeCatalogData,
} from "../workers/node-catalog.mjs";

const processor = fs.readFileSync("workers/canonical-glb-processor.mjs", "utf8");
const contract = fs.readFileSync("packages/contracts/src/node-catalog-v1.ts", "utf8");
const contractIndex = fs.readFileSync("packages/contracts/src/index.ts", "utf8");

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function fixture() {
  return {
    asset: { version: "2.0" },
    materials: [{}, {}],
    meshes: [
      { primitives: [{ material: 1 }, { material: 0 }, { material: 1 }] },
      { primitives: [{}] },
    ],
    nodes: [
      { name: "Building", children: [1, 2] },
      { name: "Room", mesh: 0 },
      { name: "Room", children: [3] },
      { name: "Chair", mesh: 1 },
    ],
  };
}

test("node catalog IDs are deterministic and scoped to canonical model identity", () => {
  const first = buildNodeCatalogData(fixture(), SHA_A);
  const second = buildNodeCatalogData(fixture(), SHA_A);
  const otherRevision = buildNodeCatalogData(fixture(), SHA_B);

  assert.deepEqual(first, second);
  assert.equal(first.nodes[0].id, "node:aaaaaaaaaaaaaaaa:0");
  assert.equal(first.nodes[1].parentId, first.nodes[0].id);
  assert.deepEqual(first.nodes[0].childIds, [first.nodes[1].id, first.nodes[2].id]);
  assert.deepEqual(first.rootIds, [first.nodes[0].id]);
  assert.notEqual(first.nodes[0].id, otherRevision.nodes[0].id);
});

test("node catalog preserves hierarchy and mapper-relevant mesh metadata without name identity", () => {
  const catalog = buildNodeCatalogData(fixture(), SHA_A);
  assert.equal(catalog.statistics.nodeCount, 4);
  assert.equal(catalog.statistics.selectableNodeCount, 2);
  assert.equal(catalog.statistics.namedNodeCount, 4);
  assert.equal(catalog.statistics.duplicateNameGroupCount, 1);
  assert.equal(catalog.nodes[1].meshIndex, 0);
  assert.equal(catalog.nodes[1].primitiveCount, 3);
  assert.deepEqual(catalog.nodes[1].materialIndices, [0, 1]);
  assert.equal(catalog.nodes[2].name, "Room");
  assert.notEqual(catalog.nodes[1].id, catalog.nodes[2].id);
});

test("node catalog fails closed on ambiguous or invalid glTF hierarchy", () => {
  assert.throws(
    () =>
      buildNodeCatalogData(
        {
          nodes: [{ children: [2] }, { children: [2] }, {}],
        },
        SHA_A,
      ),
    /more than one parent/,
  );
  assert.throws(
    () => buildNodeCatalogData({ nodes: [{ mesh: 1 }], meshes: [{}] }, SHA_A),
    /out-of-range mesh index/,
  );
  assert.throws(() => buildNodeCatalogData({ nodes: [] }, "not-a-sha"), /SHA-256 identity/);
});

test("processing emits node catalog as an immutable attempt-scoped sidecar before success", () => {
  assert.match(processor, /buildNodeCatalogData/);
  assert.match(processor, /canonical\/node-catalog\.json/);
  assert.match(processor, /artifactKind: "node-catalog"/);
  assert.match(processor, /"node-catalog"/);
  assert.match(processor, /"node-catalog-v1"/);
  assert.match(processor, /nodeCatalogSha256/);
  assert.match(processor, /results\?\.\[3\]/);
  assert.doesNotMatch(processor, /releases_3d|geo_releases_3d/);
});

test("node catalog contract is additive and exported", () => {
  assert.equal(NODE_CATALOG_FORMAT, "rekixo-node-catalog");
  assert.equal(NODE_CATALOG_VERSION, 1);
  assert.match(contract, /NODE_CATALOG_FORMAT = "rekixo-node-catalog"/);
  assert.match(contract, /canonicalModel:/);
  assert.match(contract, /duplicateNameGroupCount:/);
  assert.match(contractIndex, /export \* from "\.\/node-catalog-v1"/);
});

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { consolidateMaterialGroups } from "../scripts/asset-pipeline/convert-source-fbx.mjs";

for (const indexed of [false, true]) {
  test(`material batching preserves triangle ownership (${indexed ? "indexed" : "nonindexed"})`, () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(27), 3));
    if (indexed) geometry.setIndex([8, 7, 6, 5, 4, 3, 2, 1, 0]);
    geometry.addGroup(0, 3, 1);
    geometry.addGroup(3, 3, 0);
    geometry.addGroup(6, 3, 1);
    const assigned = () => {
      const result = [];
      for (const group of geometry.groups) {
        for (let i = group.start; i < group.start + group.count; i += 3) {
          result.push(`${group.materialIndex}:${[0, 1, 2].map(n => geometry.index ? geometry.index.getX(i + n) : i + n).join(",")}`);
        }
      }
      return result.sort();
    };
    const before = assigned();
    consolidateMaterialGroups(geometry);
    assert.deepEqual(assigned(), before);
    assert.equal(geometry.groups.length, 2);
    assert.equal(geometry.index.count, 9);
  });
}

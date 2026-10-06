export const NODE_CATALOG_FORMAT = "rekixo-node-catalog";
export const NODE_CATALOG_VERSION = 1;

function catalogError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalSha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized))
    throw catalogError(
      "NODE_CATALOG_CANONICAL_IDENTITY_INVALID",
      "Node catalog requires the verified canonical model SHA-256 identity.",
    );
  return normalized;
}

function nodeId(modelScope, index) {
  return `node:${modelScope}:${index}`;
}

function nodeName(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 300) : null;
}

function indexList(value, upperBound, fieldName) {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw catalogError("NODE_CATALOG_INVALID_GLTF", `${fieldName} must be an array when present.`);
  return value.map((item) => {
    if (!Number.isInteger(item) || item < 0 || item >= upperBound)
      throw catalogError("NODE_CATALOG_INVALID_GLTF", `${fieldName} contains an out-of-range index.`);
    return item;
  });
}

export function buildNodeCatalogData(gltf, canonicalModelSha256) {
  if (!gltf || typeof gltf !== "object" || Array.isArray(gltf))
    throw catalogError("NODE_CATALOG_INVALID_GLTF", "Node catalog source must be a glTF JSON object.");

  const canonicalSha = canonicalSha256(canonicalModelSha256);
  const modelScope = canonicalSha.slice(0, 16);
  const sourceNodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
  const parentByIndex = new Array(sourceNodes.length).fill(null);
  const childrenByIndex = sourceNodes.map((node, index) => {
    if (!node || typeof node !== "object" || Array.isArray(node))
      throw catalogError("NODE_CATALOG_INVALID_GLTF", `glTF node ${index} must be an object.`);
    const children = indexList(node.children, sourceNodes.length, `glTF node ${index} children`);
    for (const childIndex of children) {
      if (childIndex === index)
        throw catalogError("NODE_CATALOG_INVALID_GLTF", `glTF node ${index} cannot parent itself.`);
      if (parentByIndex[childIndex] !== null && parentByIndex[childIndex] !== index)
        throw catalogError(
          "NODE_CATALOG_NON_TREE_HIERARCHY",
          `glTF node ${childIndex} has more than one parent.`,
        );
      parentByIndex[childIndex] = index;
    }
    return children;
  });

  const names = new Map();
  const nodes = sourceNodes.map((node, index) => {
    const name = nodeName(node.name);
    if (name) names.set(name, (names.get(name) || 0) + 1);

    let meshIndex = null;
    let primitiveCount = 0;
    let materialIndices = [];
    if (node.mesh !== undefined) {
      if (!Number.isInteger(node.mesh) || node.mesh < 0 || node.mesh >= meshes.length)
        throw catalogError(
          "NODE_CATALOG_INVALID_GLTF",
          `glTF node ${index} references an out-of-range mesh index.`,
        );
      meshIndex = node.mesh;
      const mesh = meshes[meshIndex];
      if (!mesh || typeof mesh !== "object" || Array.isArray(mesh))
        throw catalogError("NODE_CATALOG_INVALID_GLTF", `glTF mesh ${meshIndex} must be an object.`);
      const primitives = Array.isArray(mesh.primitives) ? mesh.primitives : [];
      primitiveCount = primitives.length;
      materialIndices = [
        ...new Set(
          primitives
            .map((primitive) => primitive?.material)
            .filter((material) => Number.isInteger(material) && material >= 0),
        ),
      ].sort((a, b) => a - b);
    }

    return {
      id: nodeId(modelScope, index),
      index,
      name,
      parentId:
        parentByIndex[index] === null ? null : nodeId(modelScope, parentByIndex[index]),
      childIds: childrenByIndex[index].map((childIndex) => nodeId(modelScope, childIndex)),
      meshIndex,
      selectable: meshIndex !== null,
      primitiveCount,
      materialIndices,
    };
  });

  return {
    rootIds: nodes.filter((_, index) => parentByIndex[index] === null).map((node) => node.id),
    nodes,
    statistics: {
      nodeCount: nodes.length,
      selectableNodeCount: nodes.filter((node) => node.selectable).length,
      namedNodeCount: nodes.filter((node) => node.name !== null).length,
      duplicateNameGroupCount: [...names.values()].filter((count) => count > 1).length,
    },
  };
}

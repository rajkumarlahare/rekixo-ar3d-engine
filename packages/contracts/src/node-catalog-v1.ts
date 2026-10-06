export const NODE_CATALOG_FORMAT = "rekixo-node-catalog" as const;
export const NODE_CATALOG_VERSION = 1 as const;

export interface NodeCatalogNodeV1 {
  /** Canonical-model-scoped stable ID: node:<sha256-prefix>:<gltf-node-index>. */
  id: string;
  /** Original glTF node index inside the verified canonical GLB. */
  index: number;
  name: string | null;
  parentId: string | null;
  childIds: string[];
  meshIndex: number | null;
  selectable: boolean;
  primitiveCount: number;
  materialIndices: number[];
}

export interface NodeCatalogV1 {
  format: typeof NODE_CATALOG_FORMAT;
  version: typeof NODE_CATALOG_VERSION;
  project: {
    id: string;
    slug: string;
  };
  sourcePack: {
    id: string;
    version: number;
    manifestSha256: string;
  };
  processingJob: {
    id: string;
    processorVersion: string;
  };
  canonicalModel: {
    r2Key: string;
    sha256: string;
  };
  rootIds: string[];
  nodes: NodeCatalogNodeV1[];
  statistics: {
    nodeCount: number;
    selectableNodeCount: number;
    namedNodeCount: number;
    duplicateNameGroupCount: number;
  };
  generatedAt: string;
}

export const PROCESSING_SPINE_CONTRACT_VERSION = 1 as const;

export type ProcessingJobStateV1 =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ProcessingSourcePackSnapshotV1 {
  id: string;
  projectId: string;
  version: number;
  status: "ready" | "superseded";
  geometryAuthorityFileId: string;
  manifestSha256: string;
  approvedBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Durable orchestration state only. Canonical model/material/environment output
 * contracts are intentionally separate and versioned when their processors ship.
 */
export interface ProcessingJobV1 {
  id: string;
  projectId: string;
  sourcePackId: string;
  sourcePackVersion: number;
  sourcePackManifestSha256: string;
  processorVersion: string;
  attempt: number;
  state: ProcessingJobStateV1;
  /** Attempt-scoped R2 prefix. Derived artifacts may never escape this boundary. */
  artifactPrefix: string;
  requestedBy: string;
  requestedAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
  outputManifestSha256: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingSpineResponseV1 {
  contractVersion: typeof PROCESSING_SPINE_CONTRACT_VERSION;
  schemaReady: true;
  project: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  processorVersion: string;
  sourcePack: ProcessingSourcePackSnapshotV1 | null;
  currentJob: ProcessingJobV1 | null;
  jobs: ProcessingJobV1[];
  requestedJob?: ProcessingJobV1;
  created?: boolean;
}

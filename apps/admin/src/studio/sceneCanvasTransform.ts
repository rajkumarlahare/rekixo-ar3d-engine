import type { RoomPoint } from "./domain";

export type TransformMode = "translate" | "rotate" | "scale";

export type AtomicTransformCommit =
  | {
      kind: "room";
      id: string;
      x?: number;
      z?: number;
      width?: number;
      depth?: number;
      height?: number;
    }
  | {
      kind: "furniture";
      id: string;
      x?: number;
      z?: number;
      rotation?: number;
    }
  | {
      kind: "siteElement";
      id: string;
      x?: number;
      z?: number;
      rotation?: number;
      width?: number;
      depth?: number;
      height?: number;
    }
  | {
      kind: "wall";
      id: string;
      start?: RoomPoint;
      end?: RoomPoint;
      thickness?: number;
      height?: number;
    }
  | {
      kind: "opening";
      id: string;
      x?: number;
      z?: number;
      width?: number;
      height?: number;
    }
  | {
      kind: "model";
      x?: number;
      y?: number;
      z?: number;
      rotationY?: number;
    };

export type TransformCommit =
  | AtomicTransformCommit
  | { kind: "batch"; changes: AtomicTransformCommit[] };

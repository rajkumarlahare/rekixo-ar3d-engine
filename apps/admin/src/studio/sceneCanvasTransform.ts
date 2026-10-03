export type TransformMode = "translate" | "rotate" | "scale";

export type TransformCommit =
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
      kind: "model";
      x?: number;
      y?: number;
      z?: number;
      rotationY?: number;
    };

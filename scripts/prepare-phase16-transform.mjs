import fs from "node:fs";

const path = "apps/admin/src/studio/sceneCanvasTransform.ts";

const baseline = `export type TransformMode = "translate" | "rotate" | "scale";

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
`;

const integrated = `import type { RoomPoint } from "./domain";

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
`;

const source = fs.readFileSync(path, "utf8");
if (source.trim() !== baseline.trim()) {
  throw new Error(
    "sceneCanvasTransform.ts is not at the expected pre-integration contract; refusing to patch a divergent file.",
  );
}

fs.writeFileSync(path, integrated);

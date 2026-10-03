export type EditorTool =
  | "select"
  | "orbit"
  | "pan"
  | "wall"
  | "room-rectangle"
  | "room-polygon"
  | "door"
  | "window"
  | "furniture"
  | "site-object"
  | "measure";

export type ToolPhase = "idle" | "armed" | "drawing" | "placing";

export interface EditorToolState {
  tool: EditorTool;
  phase: ToolPhase;
  pointerId?: number;
  anchor?: readonly [number, number];
}

export function createEditorToolState(
  tool: EditorTool = "select",
): EditorToolState {
  return {
    tool,
    phase:
      tool === "select" || tool === "orbit" || tool === "pan"
        ? "idle"
        : "armed",
  };
}

export function activateEditorTool(
  state: EditorToolState,
  tool: EditorTool,
): EditorToolState {
  if (state.tool === tool) return state;
  return createEditorToolState(tool);
}

export function beginEditorToolGesture(
  state: EditorToolState,
  pointerId: number,
  anchor: readonly [number, number],
): EditorToolState {
  if (state.phase === "idle") return state;
  return {
    ...state,
    phase:
      state.tool === "furniture" ||
      state.tool === "door" ||
      state.tool === "window" ||
      state.tool === "site-object"
        ? "placing"
        : "drawing",
    pointerId,
    anchor,
  };
}

export function cancelEditorToolGesture(
  state: EditorToolState,
): EditorToolState {
  return createEditorToolState(state.tool);
}

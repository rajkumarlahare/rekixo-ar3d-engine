export type EditorPointerKind = "mouse" | "touch" | "pen" | "unknown";

export interface PointerSample {
  clientX: number;
  clientY: number;
  pointerType?: string;
}

export function normalizePointerKind(pointerType?: string): EditorPointerKind {
  if (pointerType === "mouse" || pointerType === "touch" || pointerType === "pen")
    return pointerType;
  return "unknown";
}

export function pointerActivationThreshold(pointerType?: string) {
  switch (normalizePointerKind(pointerType)) {
    case "touch":
      return 12;
    case "pen":
      return 7;
    default:
      return 5;
  }
}

export function isPointerTap(
  start: Pick<PointerSample, "clientX" | "clientY">,
  end: PointerSample,
  threshold = pointerActivationThreshold(end.pointerType),
) {
  return (
    Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) <
    threshold
  );
}

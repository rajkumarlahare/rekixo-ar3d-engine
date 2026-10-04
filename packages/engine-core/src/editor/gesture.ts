import {
  normalizePointerKind,
  pointerActivationThreshold,
  type EditorPointerKind,
  type PointerSample,
} from "./pointer";

export interface PointerGestureSample extends PointerSample {
  pointerId: number;
}

export interface PointerGestureSession {
  pointerId: number;
  pointerKind: EditorPointerKind;
  activationThreshold: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  activated: boolean;
}

export interface PointerGestureUpdate {
  accepted: boolean;
  session: PointerGestureSession;
  deltaX: number;
  deltaY: number;
  totalX: number;
  totalY: number;
  distance: number;
  activatedNow: boolean;
}

export type PointerGestureCompletionKind =
  | "tap"
  | "drag"
  | "cancel"
  | "ignored";

export interface PointerGestureCompletion {
  kind: PointerGestureCompletionKind;
  accepted: boolean;
  distance: number;
}

function assertFiniteSample(sample: PointerGestureSample) {
  if (
    !Number.isSafeInteger(sample.pointerId) ||
    sample.pointerId < 0 ||
    !Number.isFinite(sample.clientX) ||
    !Number.isFinite(sample.clientY)
  )
    throw new Error("Pointer gesture sample must contain finite client coordinates and a safe pointer ID.");
}

/**
 * Starts one editor gesture owned by exactly one browser pointer.
 *
 * The session is DOM-independent so the same ownership/activation rules can be
 * shared by mouse, pen and touch authoring tools without scene-specific logic.
 */
export function beginPointerGesture(
  sample: PointerGestureSample,
): PointerGestureSession {
  assertFiniteSample(sample);
  const pointerKind = normalizePointerKind(sample.pointerType);
  return {
    pointerId: sample.pointerId,
    pointerKind,
    activationThreshold: pointerActivationThreshold(pointerKind),
    startX: sample.clientX,
    startY: sample.clientY,
    lastX: sample.clientX,
    lastY: sample.clientY,
    activated: false,
  };
}

export function ownsPointerGesture(
  session: PointerGestureSession,
  sample: Pick<PointerGestureSample, "pointerId">,
) {
  return session.pointerId === sample.pointerId;
}

/**
 * Advances a gesture only for its owning pointer. Secondary touch/pointer input
 * is ignored instead of stealing or completing the active authoring gesture.
 */
export function updatePointerGesture(
  session: PointerGestureSession,
  sample: PointerGestureSample,
): PointerGestureUpdate {
  assertFiniteSample(sample);
  if (!ownsPointerGesture(session, sample))
    return {
      accepted: false,
      session,
      deltaX: 0,
      deltaY: 0,
      totalX: 0,
      totalY: 0,
      distance: 0,
      activatedNow: false,
    };

  const totalX = sample.clientX - session.startX;
  const totalY = sample.clientY - session.startY;
  const distance = Math.hypot(totalX, totalY);
  const activated = session.activated || distance >= session.activationThreshold;
  const next: PointerGestureSession = {
    ...session,
    lastX: sample.clientX,
    lastY: sample.clientY,
    activated,
  };
  return {
    accepted: true,
    session: next,
    deltaX: sample.clientX - session.lastX,
    deltaY: sample.clientY - session.lastY,
    totalX,
    totalY,
    distance,
    activatedNow: activated && !session.activated,
  };
}

/**
 * Completes the owning pointer as a tap/drag, or cancels it without committing.
 * A foreign pointer returns `ignored` and leaves the caller's session intact.
 */
export function finishPointerGesture(
  session: PointerGestureSession,
  sample: PointerGestureSample,
  options: { cancelled?: boolean } = {},
): PointerGestureCompletion {
  assertFiniteSample(sample);
  if (!ownsPointerGesture(session, sample))
    return { kind: "ignored", accepted: false, distance: 0 };

  const distance = Math.hypot(
    sample.clientX - session.startX,
    sample.clientY - session.startY,
  );
  if (options.cancelled)
    return { kind: "cancel", accepted: true, distance };
  return {
    kind:
      session.activated || distance >= session.activationThreshold
        ? "drag"
        : "tap",
    accepted: true,
    distance,
  };
}

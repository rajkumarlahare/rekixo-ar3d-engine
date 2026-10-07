export interface PremiumTourStep {
  id: string;
  transitionMs: number;
  holdMs: number;
  run(): void;
}

export interface PremiumTourDirector {
  readonly running: boolean;
  start(steps: readonly PremiumTourStep[]): boolean;
  cancel(): void;
}

const MIN_TRANSITION_MS = 250;
const MAX_TRANSITION_MS = 10_000;
const MAX_HOLD_MS = 30_000;
const MAX_TOUR_MS = 180_000;

export function clampPremiumCameraDuration(value: number) {
  if (!Number.isFinite(value)) return 850;
  return Math.round(
    Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, value)),
  );
}

function clampHold(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(MAX_HOLD_MS, Math.max(0, value)));
}

/**
 * One small deterministic scheduler for cinematic presentation steps.
 *
 * It deliberately owns timing only, not Building geometry or camera truth. The
 * caller supplies immutable manifest-backed actions. Reduced-motion users still
 * get the requested semantic sequence, but without automatic animated travel.
 */
export function createPremiumTourDirector(options: {
  reducedMotion: boolean;
  onStep?: (index: number, total: number, step: PremiumTourStep) => void;
  onComplete?: () => void;
}): PremiumTourDirector {
  let timer: number | undefined;
  let generation = 0;
  let active = false;

  const clear = () => {
    generation += 1;
    active = false;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const director: PremiumTourDirector = {
    get running() {
      return active;
    },
    start(inputSteps) {
      clear();
      if (!inputSteps.length) return false;

      const steps = inputSteps.map((step) => ({
        ...step,
        transitionMs: options.reducedMotion
          ? 0
          : clampPremiumCameraDuration(step.transitionMs),
        holdMs: clampHold(step.holdMs),
      }));
      const projectedMs = steps.reduce(
        (total, step) => total + step.transitionMs + step.holdMs,
        0,
      );
      if (projectedMs > MAX_TOUR_MS)
        return false;

      active = true;
      const runGeneration = generation;

      const runStep = (index: number) => {
        if (!active || runGeneration !== generation) return;
        const step = steps[index];
        if (!step) {
          active = false;
          timer = undefined;
          options.onComplete?.();
          return;
        }

        options.onStep?.(index, steps.length, step);
        step.run();
        const delay = Math.max(
          options.reducedMotion ? step.holdMs : step.transitionMs + step.holdMs,
          options.reducedMotion ? 0 : MIN_TRANSITION_MS,
        );
        timer = window.setTimeout(() => runStep(index + 1), delay);
      };

      runStep(0);
      return true;
    },
    cancel() {
      clear();
    },
  };

  return director;
}

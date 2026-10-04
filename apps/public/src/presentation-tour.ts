type PresentationStep = {
  mode: "project" | "building" | "balcony" | "floors";
  railIndex: number;
  label: string;
  holdMs: number;
};

const TOUR_STEPS: PresentationStep[] = [
  { mode: "project", railIndex: 1, label: "Project overview", holdMs: 2300 },
  { mode: "building", railIndex: 2, label: "Building facade", holdMs: 2500 },
  { mode: "balcony", railIndex: 9, label: "Facade detail", holdMs: 2400 },
  { mode: "floors", railIndex: 3, label: "Floor explorer", holdMs: 3000 },
  { mode: "building", railIndex: 2, label: "Explore freely", holdMs: 1800 },
];

const INTRO_CONTEXT_RAIL_INDEX = 10;
const INTRO_BUILDING_RAIL_INDEX = 2;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function railButton(stage: HTMLElement, railIndex: number) {
  return stage.querySelector<HTMLButtonElement>(
    `.twin-rail-item:nth-child(${railIndex})`,
  );
}

function activateRailMode(stage: HTMLElement, railIndex: number) {
  const button = railButton(stage, railIndex);
  if (!button) return false;
  button.click();
  return true;
}

function viewerReady(stage: HTMLElement) {
  return Boolean(
    stage.querySelector(".viewer-canvas") &&
      !stage.querySelector(".viewer-loader"),
  );
}

function installPresentationTour(stage: HTMLElement) {
  if (stage.dataset.presentationTourBound === "true") return;
  stage.dataset.presentationTourBound = "true";

  const shell = stage.closest<HTMLElement>(".twin-shell");
  if (!shell) return;

  const control = document.createElement("div");
  control.className = "twin-tour-control";
  control.setAttribute("aria-live", "polite");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "twin-tour-button";
  button.textContent = "Start tour";

  const status = document.createElement("span");
  status.className = "twin-tour-status";
  status.textContent = "Guided 3D tour";

  control.append(button, status);
  stage.append(control);

  let timers: number[] = [];
  let running = false;
  let introRunning = false;
  let destroyed = false;

  const clearTimers = () => {
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
  };

  const setMotionState = (active: boolean) => {
    if (active) shell.dataset.presentationMotion = "active";
    else delete shell.dataset.presentationMotion;
  };

  const resetControl = (label = "Guided 3D tour") => {
    button.textContent = "Start tour";
    status.textContent = label;
    delete shell.dataset.presentationTour;
    setMotionState(false);
  };

  const cancelPresentation = (label = "Explore freely") => {
    const wasActive = running || introRunning;
    running = false;
    introRunning = false;
    clearTimers();
    if (wasActive) resetControl(label);
  };

  const schedule = (callback: () => void, delayMs: number) => {
    const timer = window.setTimeout(() => {
      if (!destroyed) callback();
    }, delayMs);
    timers.push(timer);
  };

  const startTour = () => {
    cancelPresentation();
    running = true;
    shell.dataset.presentationTour = "running";
    setMotionState(true);
    button.textContent = "Stop tour";

    let elapsed = 0;
    TOUR_STEPS.forEach((step, index) => {
      schedule(() => {
        if (!running) return;
        status.textContent = `Tour ${index + 1}/${TOUR_STEPS.length} · ${step.label}`;
        activateRailMode(stage, step.railIndex);
      }, elapsed);
      elapsed += step.holdMs;
    });

    schedule(() => {
      if (!running) return;
      running = false;
      resetControl("Tour complete · drag to explore");
    }, elapsed);
  };

  const startIntro = () => {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      status.textContent = "Guided 3D tour";
      return;
    }

    introRunning = true;
    setMotionState(true);
    status.textContent = "Opening project";

    activateRailMode(stage, INTRO_CONTEXT_RAIL_INDEX);
    schedule(() => {
      if (!introRunning) return;
      status.textContent = "Welcome · interactive building";
      activateRailMode(stage, INTRO_BUILDING_RAIL_INDEX);
    }, 1250);
    schedule(() => {
      if (!introRunning) return;
      introRunning = false;
      resetControl("Drag to explore · or start guided tour");
    }, 2700);
  };

  button.addEventListener("click", () => {
    if (running) cancelPresentation("Tour stopped · explore freely");
    else startTour();
  });

  const cancelFromUserInput = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".twin-tour-control")) return;
    cancelPresentation();
  };

  stage.addEventListener("pointerdown", cancelFromUserInput, true);
  stage.addEventListener("wheel", cancelFromUserInput, { capture: true, passive: true });
  window.addEventListener("keydown", cancelFromUserInput, true);

  const readinessObserver = new MutationObserver(() => {
    if (!viewerReady(stage)) return;
    readinessObserver.disconnect();
    schedule(startIntro, 350);
  });

  if (viewerReady(stage)) schedule(startIntro, 350);
  else readinessObserver.observe(stage, { childList: true, subtree: true });

  const removalObserver = new MutationObserver(() => {
    if (document.contains(stage)) return;
    destroyed = true;
    clearTimers();
    readinessObserver.disconnect();
    removalObserver.disconnect();
    window.removeEventListener("keydown", cancelFromUserInput, true);
  });
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });
}

const rootObserver = new MutationObserver(() => {
  document.querySelectorAll<HTMLElement>(".twin-stage").forEach(installPresentationTour);
});

rootObserver.observe(document.documentElement, { childList: true, subtree: true });
document.querySelectorAll<HTMLElement>(".twin-stage").forEach(installPresentationTour);

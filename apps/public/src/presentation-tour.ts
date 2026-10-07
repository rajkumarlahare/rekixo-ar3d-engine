import {
  assertBuildingPresentationManifestV1,
  type BuildingPresentationManifestV1,
  type BuildingCameraKindV1,
} from "@rekixo/3d-contracts";
import {
  createPremiumTourDirector,
  type PremiumTourDirector,
  type PremiumTourStep,
} from "./premium-tour-director";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const PUBLIC_BASE = "/3Dprojects";

type SemanticFallbackStep = {
  mode: "project" | "building" | "balcony" | "floors";
  label: string;
  transitionMs: number;
  holdMs: number;
};

const FALLBACK_STEPS: SemanticFallbackStep[] = [
  {
    mode: "project",
    label: "Project overview",
    transitionMs: 900,
    holdMs: 1400,
  },
  {
    mode: "building",
    label: "Building facade",
    transitionMs: 900,
    holdMs: 1600,
  },
  {
    mode: "balcony",
    label: "Facade detail",
    transitionMs: 800,
    holdMs: 1600,
  },
  {
    mode: "floors",
    label: "Floor explorer",
    transitionMs: 850,
    holdMs: 2150,
  },
  {
    mode: "building",
    label: "Explore freely",
    transitionMs: 800,
    holdMs: 1000,
  },
];

function projectSlug() {
  const parts = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  if (
    parts[0] !== "3Dprojects" ||
    !parts[1] ||
    ["login", "showcase"].includes(parts[1])
  )
    return "";
  return parts[1].trim().toLowerCase();
}

async function presentationManifest() {
  const slug = projectSlug();
  if (!slug) return undefined;
  try {
    const response = await fetch(
      `${PUBLIC_BASE}/api/projects/${encodeURIComponent(slug)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as { buildingPresentation?: unknown };
    if (!body.buildingPresentation) return undefined;
    assertBuildingPresentationManifestV1(body.buildingPresentation);
    return body.buildingPresentation as BuildingPresentationManifestV1;
  } catch {
    return undefined;
  }
}

function railButton(stage: HTMLElement, mode: string) {
  const expected = mode.toLowerCase();
  return Array.from(
    stage.querySelectorAll<HTMLButtonElement>(".twin-rail-item"),
  ).find(
    (button) =>
      button.querySelector("strong")?.textContent?.trim().toLowerCase() ===
      expected,
  );
}

function activateRailMode(stage: HTMLElement, mode: string) {
  const button = railButton(stage, mode);
  if (!button) return false;
  button.click();
  return true;
}

const CAMERA_LABEL: Record<BuildingCameraKindV1, string> = {
  hero: "overview",
  front: "front",
  corner: "corner",
  entrance: "entry view",
  aerial: "aerial",
};

function activateCamera(stage: HTMLElement, kind: BuildingCameraKindV1) {
  activateRailMode(stage, "building");
  const label = CAMERA_LABEL[kind];
  const button = Array.from(
    stage.querySelectorAll<HTMLButtonElement>(".client-camera-views button"),
  ).find(
    (candidate) => candidate.textContent?.trim().toLowerCase() === label,
  );
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

  const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
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

  let introTimers: number[] = [];
  let running = false;
  let introRunning = false;
  let destroyed = false;
  let manifest: BuildingPresentationManifestV1 | undefined;
  let director: PremiumTourDirector | undefined;

  void presentationManifest().then((value) => {
    if (destroyed) return;
    manifest = value;
    if (value?.tour.enabled)
      status.textContent = `${value.tour.steps.length} authored camera views · Start tour`;
  });

  const clearIntroTimers = () => {
    for (const timer of introTimers) window.clearTimeout(timer);
    introTimers = [];
  };

  const scheduleIntro = (callback: () => void, delayMs: number) => {
    const timer = window.setTimeout(() => {
      if (!destroyed) callback();
    }, Math.max(0, delayMs));
    introTimers.push(timer);
  };

  const setMotionState = (active: boolean) => {
    if (active) shell.dataset.presentationMotion = "active";
    else delete shell.dataset.presentationMotion;
  };

  const resetControl = (label = "Guided 3D tour") => {
    button.textContent = "Start tour";
    status.textContent = label;
    delete shell.dataset.presentationTour;
    delete shell.dataset.presentationTourSource;
    setMotionState(false);
  };

  const cancelPresentation = (label = "Explore freely") => {
    const wasActive = running || introRunning || Boolean(director?.running);
    running = false;
    introRunning = false;
    director?.cancel();
    clearIntroTimers();
    if (wasActive) resetControl(label);
  };

  const runPremiumTour = (
    steps: readonly PremiumTourStep[],
    source: "immutable-manifest" | "semantic-fallback",
  ) => {
    director?.cancel();
    running = true;
    shell.dataset.presentationTour = "running";
    shell.dataset.presentationTourSource = source;
    setMotionState(!reducedMotion);
    button.textContent = "Stop tour";

    director = createPremiumTourDirector({
      reducedMotion,
      onStep(index, total, step) {
        if (!running) return;
        status.textContent = `Tour ${index + 1}/${total} · ${step.id}`;
      },
      onComplete() {
        if (!running) return;
        running = false;
        resetControl("Tour complete · drag to explore");
      },
    });

    if (!director.start(steps)) {
      running = false;
      resetControl("Tour unavailable · explore freely");
      return false;
    }
    return true;
  };

  const startManifestTour = (value: BuildingPresentationManifestV1) => {
    const shots = new Map(value.cameras.shots.map((shot) => [shot.id, shot]));
    const steps = value.tour.steps.flatMap<PremiumTourStep>((step) => {
      const shot = shots.get(step.shotId);
      if (!shot) return [];
      return [
        {
          id: shot.kind,
          transitionMs: step.durationMs,
          holdMs: step.holdMs,
          run: () => {
            if (running) activateCamera(stage, shot.kind);
          },
        },
      ];
    });
    return steps.length
      ? runPremiumTour(steps, "immutable-manifest")
      : false;
  };

  const startFallbackTour = () =>
    runPremiumTour(
      FALLBACK_STEPS.map((step) => ({
        id: step.label,
        transitionMs: step.transitionMs,
        holdMs: step.holdMs,
        run: () => {
          if (running) activateRailMode(stage, step.mode);
        },
      })),
      "semantic-fallback",
    );

  const startTour = () => {
    cancelPresentation();
    if (manifest?.tour.enabled && startManifestTour(manifest)) return;
    startFallbackTour();
  };

  const startIntro = () => {
    if (reducedMotion) {
      status.textContent = manifest?.tour.enabled
        ? "Authored 3D tour available"
        : "Guided 3D tour";
      return;
    }
    introRunning = true;
    setMotionState(true);
    status.textContent = "Opening project";
    activateRailMode(stage, "context");
    scheduleIntro(() => {
      if (!introRunning) return;
      status.textContent = "Welcome · interactive building";
      activateRailMode(stage, "building");
      if (manifest?.cameras.shots.some((shot) => shot.kind === "hero"))
        activateCamera(stage, "hero");
    }, 1250);
    scheduleIntro(() => {
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
    if (
      target instanceof Element &&
      target.closest(".twin-tour-control")
    )
      return;
    cancelPresentation();
  };
  const cancelWhenHidden = () => {
    if (document.hidden)
      cancelPresentation("Tour paused · start again when ready");
  };

  stage.addEventListener("pointerdown", cancelFromUserInput, true);
  stage.addEventListener("wheel", cancelFromUserInput, {
    capture: true,
    passive: true,
  });
  window.addEventListener("keydown", cancelFromUserInput, true);
  document.addEventListener("visibilitychange", cancelWhenHidden);

  const readinessObserver = new MutationObserver(() => {
    if (!viewerReady(stage)) return;
    readinessObserver.disconnect();
    scheduleIntro(startIntro, 350);
  });
  if (viewerReady(stage)) scheduleIntro(startIntro, 350);
  else readinessObserver.observe(stage, { childList: true, subtree: true });

  const removalObserver = new MutationObserver(() => {
    if (document.contains(stage)) return;
    destroyed = true;
    director?.cancel();
    clearIntroTimers();
    readinessObserver.disconnect();
    removalObserver.disconnect();
    window.removeEventListener("keydown", cancelFromUserInput, true);
    document.removeEventListener("visibilitychange", cancelWhenHidden);
  });
  removalObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

const rootObserver = new MutationObserver(() => {
  document
    .querySelectorAll<HTMLElement>(".twin-stage")
    .forEach(installPresentationTour);
});
rootObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
document
  .querySelectorAll<HTMLElement>(".twin-stage")
  .forEach(installPresentationTour);

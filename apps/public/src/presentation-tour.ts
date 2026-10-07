import {
  assertBuildingPresentationManifestV1,
  type BuildingPresentationManifestV1,
  type BuildingCameraKindV1,
} from "@rekixo/3d-contracts";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const PUBLIC_BASE = "/3Dprojects";

type SemanticFallbackStep = {
  mode: "project" | "building" | "balcony" | "floors";
  label: string;
  holdMs: number;
};

const FALLBACK_STEPS: SemanticFallbackStep[] = [
  { mode: "project", label: "Project overview", holdMs: 2300 },
  { mode: "building", label: "Building facade", holdMs: 2500 },
  { mode: "balcony", label: "Facade detail", holdMs: 2400 },
  { mode: "floors", label: "Floor explorer", holdMs: 3000 },
  { mode: "building", label: "Explore freely", holdMs: 1800 },
];

function projectSlug() {
  const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "3Dprojects" || !parts[1] || ["login", "showcase"].includes(parts[1]))
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
  return Array.from(stage.querySelectorAll<HTMLButtonElement>(".twin-rail-item"))
    .find((button) => button.querySelector("strong")?.textContent?.trim().toLowerCase() === expected);
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
  ).find((candidate) => candidate.textContent?.trim().toLowerCase() === label);
  if (!button) return false;
  button.click();
  return true;
}

function viewerReady(stage: HTMLElement) {
  return Boolean(stage.querySelector(".viewer-canvas") && !stage.querySelector(".viewer-loader"));
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
  let manifest: BuildingPresentationManifestV1 | undefined;
  void presentationManifest().then((value) => {
    manifest = value;
    if (value?.tour.enabled)
      status.textContent = `${value.tour.steps.length} authored camera views · Start tour`;
  });

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
    }, Math.max(0, delayMs));
    timers.push(timer);
  };

  const startManifestTour = (value: BuildingPresentationManifestV1) => {
    const shots = new Map(value.cameras.shots.map((shot) => [shot.id, shot]));
    const steps = value.tour.steps
      .map((step) => ({ ...step, shot: shots.get(step.shotId) }))
      .filter((step) => Boolean(step.shot));
    if (!steps.length) return false;

    running = true;
    shell.dataset.presentationTour = "running";
    shell.dataset.presentationTourSource = "immutable-manifest";
    setMotionState(true);
    button.textContent = "Stop tour";

    let elapsed = 0;
    steps.forEach((step, index) => {
      schedule(() => {
        if (!running || !step.shot) return;
        status.textContent = `Tour ${index + 1}/${steps.length} · ${step.shot.kind}`;
        activateCamera(stage, step.shot.kind);
      }, elapsed);
      elapsed += step.durationMs + step.holdMs;
    });
    schedule(() => {
      if (!running) return;
      running = false;
      delete shell.dataset.presentationTourSource;
      resetControl("Tour complete · drag to explore");
    }, elapsed);
    return true;
  };

  const startFallbackTour = () => {
    running = true;
    shell.dataset.presentationTour = "running";
    shell.dataset.presentationTourSource = "semantic-fallback";
    setMotionState(true);
    button.textContent = "Stop tour";
    let elapsed = 0;
    FALLBACK_STEPS.forEach((step, index) => {
      schedule(() => {
        if (!running) return;
        status.textContent = `Tour ${index + 1}/${FALLBACK_STEPS.length} · ${step.label}`;
        activateRailMode(stage, step.mode);
      }, elapsed);
      elapsed += step.holdMs;
    });
    schedule(() => {
      if (!running) return;
      running = false;
      delete shell.dataset.presentationTourSource;
      resetControl("Tour complete · drag to explore");
    }, elapsed);
  };

  const startTour = () => {
    cancelPresentation();
    if (manifest?.tour.enabled && startManifestTour(manifest)) return;
    startFallbackTour();
  };

  const startIntro = () => {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      status.textContent = manifest?.tour.enabled ? "Authored 3D tour available" : "Guided 3D tour";
      return;
    }
    introRunning = true;
    setMotionState(true);
    status.textContent = "Opening project";
    activateRailMode(stage, "context");
    schedule(() => {
      if (!introRunning) return;
      status.textContent = "Welcome · interactive building";
      activateRailMode(stage, "building");
      if (manifest?.cameras.shots.some((shot) => shot.kind === "hero"))
        activateCamera(stage, "hero");
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

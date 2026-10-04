type NavigatorWithRuntimeHints = Navigator & {
  deviceMemory?: number;
  connection?: {
    saveData?: boolean;
    effectiveType?: string;
  };
};

const nav = navigator as NavigatorWithRuntimeHints;
const root = document.documentElement;

const lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
const lowCpu = typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4;
const saveData = Boolean(nav.connection?.saveData);
const slowConnection = /(^|-)2g$/.test(nav.connection?.effectiveType ?? "");
const compactScreen = window.matchMedia("(max-width: 760px)").matches;
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const lowPowerUi = saveData || slowConnection || (lowMemory && lowCpu) || (compactScreen && lowCpu);

root.dataset.demoQuality = lowPowerUi ? "low" : "standard";
root.classList.toggle("demo-low-power", lowPowerUi);
root.classList.toggle("demo-touch-device", coarsePointer);
root.classList.toggle("demo-reduced-motion", reducedMotion);
root.classList.add("demo-is-loading");

function decorateRuntimeState() {
  const loader = document.querySelector<HTMLElement>(".viewer-loader");
  const notice = document.querySelector<HTMLElement>(".viewer-notice");
  const canvas = document.querySelector<HTMLCanvasElement>(".viewer-canvas");

  root.classList.toggle("demo-is-loading", Boolean(loader));
  root.classList.toggle("demo-viewer-ready", Boolean(canvas) && !loader);
  root.classList.toggle("demo-viewer-warning", Boolean(notice));

  if (loader) {
    loader.dataset.demoLoading = "true";
    const title = loader.querySelector<HTMLElement>("span");
    if (title?.textContent === "Preparing 3D experience") {
      title.textContent = "Loading interactive 3D";
    }
  }

  if (notice) {
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
  }
}

let queued = false;
function scheduleDecoration() {
  if (queued) return;
  queued = true;
  window.requestAnimationFrame(() => {
    queued = false;
    decorateRuntimeState();
  });
}

const observer = new MutationObserver(scheduleDecoration);
observer.observe(document.body, { childList: true, subtree: true });

decorateRuntimeState();

window.addEventListener("pageshow", decorateRuntimeState);
window.addEventListener("online", decorateRuntimeState);
window.addEventListener("offline", decorateRuntimeState);

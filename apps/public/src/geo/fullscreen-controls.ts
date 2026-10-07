const FULLSCREEN_CLONE_CLASS = "geo-camera-toolbar--fullscreen-clone";
const HEADER_CLONE_CLASS = "geo-camera-toolbar--header-clone";
const HEADER_SLOT_CLASS = "jio-public-header-camera-slot";

let activeFullscreenClone: HTMLElement | null = null;
let fullscreenStateObserver: MutationObserver | null = null;
let activeHeaderClone: HTMLElement | null = null;
let headerStateObserver: MutationObserver | null = null;
let structureFrame = 0;

function toolbarButtons(toolbar: HTMLElement) {
  return Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
}

function syncToolbarState(original: HTMLElement, clone: HTMLElement) {
  const sourceButtons = toolbarButtons(original);
  const cloneButtons = toolbarButtons(clone);
  cloneButtons.forEach((button, index) => {
    const source = sourceButtons[index];
    if (!source) return;
    button.className = source.className;
    button.setAttribute("aria-pressed", source.getAttribute("aria-pressed") || "false");
    button.title = source.title;
    button.disabled = source.disabled;
  });
}

function wireProxyButtons(original: HTMLElement, clone: HTMLElement) {
  const sourceButtons = toolbarButtons(original);
  const cloneButtons = toolbarButtons(clone);
  cloneButtons.forEach((button, index) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sourceButtons[index]?.click();
      window.requestAnimationFrame(() => syncToolbarState(original, clone));
    });
  });
}

function observeToolbarState(original: HTMLElement, clone: HTMLElement, kind: "header" | "fullscreen") {
  const observer = new MutationObserver(() => syncToolbarState(original, clone));
  observer.observe(original, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-pressed", "title", "disabled"],
  });
  if (kind === "header") {
    headerStateObserver?.disconnect();
    headerStateObserver = observer;
  } else {
    fullscreenStateObserver?.disconnect();
    fullscreenStateObserver = observer;
  }
}

function createProxyToolbar(original: HTMLElement, kind: "header" | "fullscreen") {
  const clone = original.cloneNode(true) as HTMLElement;
  clone.classList.add(kind === "header" ? HEADER_CLONE_CLASS : FULLSCREEN_CLONE_CLASS);
  clone.setAttribute("data-geo-camera-proxy", kind);
  wireProxyButtons(original, clone);
  syncToolbarState(original, clone);
  observeToolbarState(original, clone, kind);
  return clone;
}

function originalToolbar(scene?: Element | null) {
  const selector = `.geo-camera-toolbar:not(.${FULLSCREEN_CLONE_CLASS}):not(.${HEADER_CLONE_CLASS})`;
  return (scene || document).querySelector<HTMLElement>(selector);
}

function clearFullscreenClone() {
  fullscreenStateObserver?.disconnect();
  fullscreenStateObserver = null;
  activeFullscreenClone?.remove();
  activeFullscreenClone = null;
}

function clearHeaderClone() {
  headerStateObserver?.disconnect();
  headerStateObserver = null;
  activeHeaderClone?.remove();
  activeHeaderClone = null;
}

function ensureHeaderToolbar() {
  const header = document.querySelector<HTMLElement>(".jio-public-header");
  const actions = header?.querySelector<HTMLElement>(".jio-public-header-actions");
  const source = originalToolbar(document.querySelector(".geo-integrated-scene"));

  if (!header || !actions || !source) {
    clearHeaderClone();
    return;
  }

  let slot = header.querySelector<HTMLElement>(`.${HEADER_SLOT_CLASS}`);
  if (!slot) {
    slot = document.createElement("div");
    slot.className = HEADER_SLOT_CLASS;
    slot.setAttribute("aria-label", "3D Geo camera views");
    actions.insertAdjacentElement("afterend", slot);
  }

  if (
    activeHeaderClone?.isConnected &&
    activeHeaderClone.parentElement === slot &&
    activeHeaderClone.dataset.sourceToolbar === "current"
  ) {
    syncToolbarState(source, activeHeaderClone);
    return;
  }

  clearHeaderClone();
  const clone = createProxyToolbar(source, "header");
  clone.dataset.sourceToolbar = "current";
  slot.replaceChildren(clone);
  activeHeaderClone = clone;
}

function scheduleHeaderToolbar() {
  if (structureFrame) return;
  structureFrame = window.requestAnimationFrame(() => {
    structureFrame = 0;
    ensureHeaderToolbar();
  });
}

function sceneForFullscreenElement(fullscreenElement: Element) {
  const direct = fullscreenElement.closest(".geo-integrated-scene");
  if (direct) return direct;

  return Array.from(document.querySelectorAll(".geo-integrated-scene")).find((scene) => {
    const map = scene.querySelector(".geo-integrated-map");
    return Boolean(map && (map.contains(fullscreenElement) || fullscreenElement.contains(map)));
  }) || null;
}

function mountFullscreenClone() {
  clearFullscreenClone();
  const fullscreenElement = document.fullscreenElement;
  if (!fullscreenElement) return;

  const scene = sceneForFullscreenElement(fullscreenElement);
  if (!scene) return;
  const source = originalToolbar(scene);
  if (!source || fullscreenElement.contains(source)) return;

  const clone = createProxyToolbar(source, "fullscreen");
  fullscreenElement.appendChild(clone);
  activeFullscreenClone = clone;
}

function handleFullscreenChange() {
  if (!document.fullscreenElement) {
    clearFullscreenClone();
    scheduleHeaderToolbar();
    return;
  }
  window.requestAnimationFrame(mountFullscreenClone);
}

document.addEventListener("fullscreenchange", handleFullscreenChange);

const structureObserver = new MutationObserver(scheduleHeaderToolbar);
structureObserver.observe(document.documentElement, { childList: true, subtree: true });

scheduleHeaderToolbar();

const FULLSCREEN_CLONE_CLASS = "geo-camera-toolbar--fullscreen-clone";

let activeFullscreenClone: HTMLElement | null = null;
let fullscreenStateObserver: MutationObserver | null = null;

function toolbarButtons(toolbar: HTMLElement) {
  return Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
}

function syncToolbarState(original: HTMLElement, clone: HTMLElement) {
  const originals = toolbarButtons(original);
  toolbarButtons(clone).forEach((button, index) => {
    const source = originals[index];
    if (!source) return;
    button.className = source.className;
    button.setAttribute("aria-pressed", source.getAttribute("aria-pressed") || "false");
    button.title = source.title;
    button.disabled = source.disabled;
  });
}

function clearFullscreenClone() {
  fullscreenStateObserver?.disconnect();
  fullscreenStateObserver = null;
  activeFullscreenClone?.remove();
  activeFullscreenClone = null;
}

function mountFullscreenClone() {
  clearFullscreenClone();
  const fullscreenElement = document.fullscreenElement;
  if (!fullscreenElement) return;
  const scene = fullscreenElement.closest(".geo-integrated-scene") ||
    Array.from(document.querySelectorAll(".geo-integrated-scene")).find((candidate) => {
      const map = candidate.querySelector(".geo-integrated-map");
      return Boolean(map && (map.contains(fullscreenElement) || fullscreenElement.contains(map)));
    });
  if (!scene) return;
  const original = scene.querySelector<HTMLElement>(".geo-camera-toolbar:not(.geo-camera-toolbar--fullscreen-clone)");
  if (!original || fullscreenElement.contains(original)) return;

  const clone = original.cloneNode(true) as HTMLElement;
  clone.classList.add(FULLSCREEN_CLONE_CLASS);
  clone.setAttribute("data-geo-camera-proxy", "fullscreen");
  const originals = toolbarButtons(original);
  toolbarButtons(clone).forEach((button, index) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      originals[index]?.click();
      window.requestAnimationFrame(() => syncToolbarState(original, clone));
    });
  });
  syncToolbarState(original, clone);
  const observer = new MutationObserver(() => syncToolbarState(original, clone));
  observer.observe(original, { subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "title", "disabled"] });
  fullscreenStateObserver = observer;
  fullscreenElement.appendChild(clone);
  activeFullscreenClone = clone;
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    clearFullscreenClone();
    return;
  }
  window.requestAnimationFrame(mountFullscreenClone);
});

export {};

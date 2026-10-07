const CLONE_CLASS = "geo-camera-toolbar--fullscreen-clone";

let activeClone: HTMLElement | null = null;
let activeObserver: MutationObserver | null = null;

function originalToolbar(scene: Element) {
  return scene.querySelector<HTMLElement>(`.geo-camera-toolbar:not(.${CLONE_CLASS})`);
}

function clearFullscreenClone() {
  activeObserver?.disconnect();
  activeObserver = null;
  activeClone?.remove();
  activeClone = null;
}

function syncToolbarState(original: HTMLElement, clone: HTMLElement) {
  const sourceButtons = Array.from(original.querySelectorAll<HTMLButtonElement>("button"));
  const cloneButtons = Array.from(clone.querySelectorAll<HTMLButtonElement>("button"));
  cloneButtons.forEach((button, index) => {
    const source = sourceButtons[index];
    if (!source) return;
    button.className = source.className;
    button.setAttribute("aria-pressed", source.getAttribute("aria-pressed") || "false");
    button.title = source.title;
    button.disabled = source.disabled;
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
  const original = originalToolbar(scene);
  if (!original || fullscreenElement.contains(original)) return;

  const clone = original.cloneNode(true) as HTMLElement;
  clone.classList.add(CLONE_CLASS);
  clone.setAttribute("data-fullscreen-proxy", "true");

  const sourceButtons = Array.from(original.querySelectorAll<HTMLButtonElement>("button"));
  const cloneButtons = Array.from(clone.querySelectorAll<HTMLButtonElement>("button"));
  cloneButtons.forEach((button, index) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sourceButtons[index]?.click();
      window.requestAnimationFrame(() => syncToolbarState(original, clone));
    });
  });

  syncToolbarState(original, clone);
  fullscreenElement.appendChild(clone);
  activeClone = clone;

  activeObserver = new MutationObserver(() => syncToolbarState(original, clone));
  activeObserver.observe(original, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-pressed", "title", "disabled"],
  });
}

function handleFullscreenChange() {
  if (!document.fullscreenElement) {
    clearFullscreenClone();
    return;
  }
  window.requestAnimationFrame(mountFullscreenClone);
}

document.addEventListener("fullscreenchange", handleFullscreenChange);

export {};

type WalkUi = {
  root: HTMLDivElement;
  location: HTMLElement;
  hint: HTMLElement;
  exit: HTMLButtonElement;
};

function textOf(element: Element | null) {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function currentWalkLocation(shell: HTMLElement) {
  const graphTitle = shell.querySelector(".viewer-walk-graph__head strong");
  const roomSelect = shell.querySelector<HTMLSelectElement>(".viewer-room-toolbar select");
  const selectedOption = roomSelect?.selectedOptions?.[0];
  const selectedText = selectedOption && !selectedOption.disabled ? textOf(selectedOption) : "";
  return textOf(graphTitle) || selectedText || "Eye-level walkthrough";
}

function createWalkUi(shell: HTMLElement): WalkUi {
  const root = document.createElement("div");
  root.className = "viewer-walk-hud";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const copy = document.createElement("div");
  copy.className = "viewer-walk-hud__copy";

  const eyebrow = document.createElement("span");
  eyebrow.textContent = "WALK MODE";

  const location = document.createElement("strong");
  location.textContent = "Eye-level walkthrough";

  const hint = document.createElement("small");
  hint.textContent = "Drag to look · hold arrows to move";

  copy.append(eyebrow, location, hint);

  const exit = document.createElement("button");
  exit.type = "button";
  exit.className = "viewer-walk-hud__exit";
  exit.textContent = "Exit walk";
  exit.setAttribute("aria-label", "Exit walkthrough and return to building view");

  root.append(copy, exit);
  shell.append(root);
  return { root, location, hint, exit };
}

function leaveWalk(shell: HTMLElement) {
  const orbitButton = Array.from(shell.querySelectorAll<HTMLButtonElement>(".viewer-action"))
    .find((button) => textOf(button).toLowerCase() === "orbit");
  if (orbitButton) {
    orbitButton.click();
    return;
  }

  const stage = shell.closest<HTMLElement>(".twin-stage");
  const buildingButton = Array.from(stage?.querySelectorAll<HTMLButtonElement>(".twin-rail-item") ?? [])
    .find((button) => textOf(button).toLowerCase().includes("building"));
  buildingButton?.click();
}

function installWalkthroughPolish(shell: HTMLElement) {
  if (shell.dataset.walkthroughPolishBound === "true") return;
  shell.dataset.walkthroughPolishBound = "true";

  const ui = createWalkUi(shell);
  ui.root.hidden = true;
  let destroyed = false;

  const sync = () => {
    if (destroyed) return;
    if (!shell.contains(ui.root)) shell.append(ui.root);

    const active = Boolean(shell.querySelector(".viewer-walk-controls"));
    shell.toggleAttribute("data-walkthrough-active", active);
    ui.root.hidden = !active;
    if (!active) return;

    ui.location.textContent = currentWalkLocation(shell);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    ui.hint.textContent = coarse
      ? "Drag to look · hold on-screen arrows to move"
      : "Drag to look · WASD / arrows to move · Esc exits";
  };

  ui.exit.addEventListener("click", () => leaveWalk(shell));

  const observer = new MutationObserver(sync);
  observer.observe(shell, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "value"],
  });
  sync();

  const removalObserver = new MutationObserver(() => {
    if (document.contains(shell)) return;
    destroyed = true;
    observer.disconnect();
    removalObserver.disconnect();
  });
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });
}

const walkthroughRootObserver = new MutationObserver(() => {
  document.querySelectorAll<HTMLElement>(".viewer-shell").forEach(installWalkthroughPolish);
});

walkthroughRootObserver.observe(document.documentElement, { childList: true, subtree: true });
document.querySelectorAll<HTMLElement>(".viewer-shell").forEach(installWalkthroughPolish);

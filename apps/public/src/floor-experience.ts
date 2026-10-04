const FLOOR_MODE_INDEX = 3;
const FLATS_MODE_INDEX = 4;

type FloorUi = {
  root: HTMLDivElement;
  title: HTMLElement;
  detail: HTMLElement;
  previous: HTMLButtonElement;
  all: HTMLButtonElement;
  next: HTMLButtonElement;
};

function railMode(stage: HTMLElement) {
  const buttons = Array.from(
    stage.querySelectorAll<HTMLButtonElement>(".twin-rail-item"),
  );
  const active = buttons.findIndex((button) =>
    button.classList.contains("twin-rail-item--active"),
  );
  return active + 1;
}

function stripButtons(stage: HTMLElement) {
  return Array.from(
    stage.querySelectorAll<HTMLButtonElement>(".twin-floor-strip button"),
  );
}

function floorButtons(stage: HTMLElement) {
  return stripButtons(stage).filter(
    (button) => button.textContent?.trim().toUpperCase() !== "ALL",
  );
}

function selectedFloorButton(stage: HTMLElement) {
  return floorButtons(stage).find((button) => button.classList.contains("active"));
}

function allFloorsButton(stage: HTMLElement) {
  return stripButtons(stage).find(
    (button) => button.textContent?.trim().toUpperCase() === "ALL",
  );
}

function prettyFloor(label: string) {
  const normalized = label.trim().toUpperCase();
  if (normalized === "G") return "Ground floor";
  if (/^F\d+$/.test(normalized)) return `Floor ${normalized.slice(1)}`;
  if (/^B\d+$/.test(normalized)) return `Basement ${normalized.slice(1)}`;
  return label.trim();
}

function createFloorUi(stage: HTMLElement): FloorUi {
  const root = document.createElement("div");
  root.className = "twin-floor-focus";
  root.setAttribute("aria-live", "polite");
  root.hidden = true;

  const copy = document.createElement("div");
  copy.className = "twin-floor-focus__copy";

  const eyebrow = document.createElement("span");
  eyebrow.textContent = "FLOOR VIEW";

  const title = document.createElement("strong");
  title.textContent = "All floors";

  const detail = document.createElement("small");
  detail.textContent = "Exploded building stack";

  copy.append(eyebrow, title, detail);

  const controls = document.createElement("div");
  controls.className = "twin-floor-focus__controls";

  const previous = document.createElement("button");
  previous.type = "button";
  previous.setAttribute("aria-label", "Previous floor");
  previous.textContent = "‹";

  const all = document.createElement("button");
  all.type = "button";
  all.className = "twin-floor-focus__all";
  all.textContent = "All";

  const next = document.createElement("button");
  next.type = "button";
  next.setAttribute("aria-label", "Next floor");
  next.textContent = "›";

  controls.append(previous, all, next);
  root.append(copy, controls);
  stage.append(root);

  return { root, title, detail, previous, all, next };
}

function installFloorExperience(stage: HTMLElement) {
  if (stage.dataset.floorExperienceBound === "true") return;
  stage.dataset.floorExperienceBound = "true";

  const ui = createFloorUi(stage);
  let destroyed = false;

  const sync = () => {
    if (destroyed) return;
    if (!stage.contains(ui.root)) stage.append(ui.root);

    const mode = railMode(stage);
    const floorMode = mode === FLOOR_MODE_INDEX;
    const flatsMode = mode === FLATS_MODE_INDEX;
    const active = floorMode || flatsMode;
    ui.root.hidden = !active;
    stage.toggleAttribute("data-floor-explorer-active", active);
    if (!active) return;

    const selected = selectedFloorButton(stage);
    const floors = floorButtons(stage);
    const selectedIndex = selected ? floors.indexOf(selected) : -1;
    const allButton = allFloorsButton(stage);

    if (selected) {
      const label = selected.textContent?.trim() || "Floor";
      ui.title.textContent = prettyFloor(label);
      ui.detail.textContent = flatsMode
        ? "Flat information for this level"
        : "Isolated 3D floor · drag, zoom and orbit";
      stage.dataset.floorFocus = label.toLowerCase();
    } else {
      ui.title.textContent = "All floors";
      ui.detail.textContent = floorMode
        ? "Exploded building stack · choose a floor to isolate"
        : "Choose a floor";
      stage.dataset.floorFocus = "all";
    }

    ui.previous.disabled = floors.length === 0 || selectedIndex === 0;
    ui.next.disabled = floors.length === 0 || selectedIndex === floors.length - 1;
    if (selectedIndex < 0 && floors.length > 0) {
      ui.previous.disabled = true;
      ui.next.disabled = false;
    }
    ui.all.hidden = !floorMode || !allButton;
    ui.all.disabled = !selected;
  };

  const move = (direction: -1 | 1) => {
    const floors = floorButtons(stage);
    if (!floors.length) return;
    const selected = selectedFloorButton(stage);
    const index = selected ? floors.indexOf(selected) : -1;
    const targetIndex = index < 0
      ? direction > 0 ? 0 : floors.length - 1
      : Math.max(0, Math.min(floors.length - 1, index + direction));
    floors[targetIndex]?.click();
  };

  ui.previous.addEventListener("click", () => move(-1));
  ui.next.addEventListener("click", () => move(1));
  ui.all.addEventListener("click", () => allFloorsButton(stage)?.click());

  const handleKey = (event: KeyboardEvent) => {
    const mode = railMode(stage);
    if (mode !== FLOOR_MODE_INDEX && mode !== FLATS_MODE_INDEX) return;
    if (event.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;

    if (event.key === "PageUp") {
      event.preventDefault();
      move(1);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      move(-1);
    } else if ((event.key === "0" || event.key === "Home") && mode === FLOOR_MODE_INDEX) {
      const all = allFloorsButton(stage);
      if (all) {
        event.preventDefault();
        all.click();
      }
    }
  };

  window.addEventListener("keydown", handleKey);

  const observer = new MutationObserver(sync);
  observer.observe(stage, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  sync();

  const removalObserver = new MutationObserver(() => {
    if (document.contains(stage)) return;
    destroyed = true;
    observer.disconnect();
    removalObserver.disconnect();
    window.removeEventListener("keydown", handleKey);
  });
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });
}

const rootObserver = new MutationObserver(() => {
  document.querySelectorAll<HTMLElement>(".twin-stage").forEach(installFloorExperience);
});

rootObserver.observe(document.documentElement, { childList: true, subtree: true });
document.querySelectorAll<HTMLElement>(".twin-stage").forEach(installFloorExperience);

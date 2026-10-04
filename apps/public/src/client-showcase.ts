const ROOT_SELECTOR = ".experience";
const READY_LABEL = "Available";
const PENDING_LABEL = "Source pending";

function textOf(element: Element | null | undefined) {
  return element?.textContent?.trim() ?? "";
}

function appendTextElement(
  parent: HTMLElement,
  tagName: "span" | "strong" | "small",
  text: string,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function mapSearchUrl(projectName: string, location: string) {
  const query = [projectName, location].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function ensureHeroOverlay(root: HTMLElement) {
  const viewerSection = root.querySelector<HTMLElement>(".viewer-section");
  if (!viewerSection || viewerSection.querySelector(".client-hero-overlay")) return;

  const projectName = textOf(root.querySelector(".project-heading h1"));
  const location = textOf(root.querySelector(".project-heading .location"));
  const overlay = document.createElement("div");
  overlay.className = "client-hero-overlay";
  overlay.setAttribute("aria-hidden", "true");

  appendTextElement(overlay, "span", "INTERACTIVE 3D EXPERIENCE", "client-hero-kicker");
  appendTextElement(overlay, "strong", projectName || "3D Project");
  appendTextElement(overlay, "small", location || "Explore the live building model");

  const hints = document.createElement("div");
  hints.className = "client-hero-hints";
  for (const hint of ["Drag to rotate", "Scroll to zoom", "Day / Night"]) {
    appendTextElement(hints, "span", hint);
  }
  overlay.appendChild(hints);
  viewerSection.appendChild(overlay);
}

function ensureLocationCard(root: HTMLElement) {
  const overview = root.querySelector<HTMLElement>(".project-overview");
  const copy = overview?.querySelector<HTMLElement>(".overview-copy");
  if (!overview || !copy || overview.querySelector(".client-location-card")) return;

  const projectName = textOf(root.querySelector(".project-heading h1"));
  const location = textOf(root.querySelector(".project-heading .location"));
  if (!location) return;

  const description = copy.querySelector<HTMLElement>(":scope > p:not(.eyebrow)");
  if (description) {
    description.textContent =
      "Explore the building in interactive 3D, inspect the exterior from every angle, switch day/night and open the project location in Maps.";
  }

  const card = document.createElement("div");
  card.className = "client-location-card";

  const locationCopy = document.createElement("div");
  appendTextElement(locationCopy, "span", "PROJECT LOCATION");
  appendTextElement(locationCopy, "strong", location);
  appendTextElement(
    locationCopy,
    "small",
    "Open the configured project name and locality in Google Maps.",
  );

  const link = document.createElement("a");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.href = mapSearchUrl(projectName, location);
  link.textContent = "Open in Maps ↗";

  card.append(locationCopy, link);
  copy.appendChild(card);
}

function polishViewerControls(root: HTMLElement, floorModuleReady: boolean) {
  root.querySelectorAll<HTMLButtonElement>(".viewer-action").forEach((button) => {
    const label = textOf(button).toLowerCase();
    if (!floorModuleReady && ["walk", "explode", "section"].includes(label)) {
      button.hidden = true;
      button.setAttribute("aria-hidden", "true");
    }
    if (label === "reset") button.setAttribute("aria-label", "Reset camera view");
  });
}

function polishRoot(root: HTMLElement) {
  document.body.classList.add("client-showcase-active");
  root.classList.add("client-showcase");

  const modules = Array.from(root.querySelectorAll<HTMLButtonElement>(".module"));
  const readyModules = modules.filter(
    (button) => textOf(button.querySelector("small")) === READY_LABEL,
  );
  const floorModuleReady = modules.some(
    (button) =>
      textOf(button.querySelector("strong")) === "Floor Explorer" &&
      textOf(button.querySelector("small")) === READY_LABEL,
  );

  for (const button of modules) {
    if (textOf(button.querySelector("small")) !== PENDING_LABEL) continue;
    button.hidden = true;
    button.setAttribute("aria-hidden", "true");
  }

  const nav = root.querySelector<HTMLElement>(".module-nav");
  if (nav) nav.classList.toggle("client-module-nav--single", readyModules.length <= 1);

  root.querySelector<HTMLElement>(".production-badge")?.setAttribute("hidden", "true");
  root.querySelector<HTMLElement>(".source-note")?.setAttribute("hidden", "true");

  const overview = root.querySelector<HTMLElement>(".project-overview");
  if (overview) {
    overview.classList.add("client-showcase-overview");
    overview.querySelector<HTMLElement>(".media-placeholder")?.setAttribute("hidden", "true");
  }

  ensureHeroOverlay(root);
  ensureLocationCard(root);
  polishViewerControls(root, floorModuleReady);
}

let scheduled = false;
function scan() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    document.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach(polishRoot);
  });
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();

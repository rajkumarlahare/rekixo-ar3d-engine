const ROOT_SELECTOR = ".experience";
const READY_LABEL = "Available";
const PENDING_LABEL = "Source pending";

function textOf(element: Element | null | undefined) {
  return element?.textContent?.trim() ?? "";
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
  overlay.innerHTML = `
    <span class="client-hero-kicker">INTERACTIVE 3D EXPERIENCE</span>
    <strong>${projectName || "3D Project"}</strong>
    <small>${location || "Explore the live building model"}</small>
    <div class="client-hero-hints">
      <span>Drag to rotate</span>
      <span>Scroll to zoom</span>
      <span>Day / Night</span>
    </div>
  `;
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
  card.innerHTML = `
    <div>
      <span>PROJECT LOCATION</span>
      <strong>${location}</strong>
      <small>Open the configured project name and locality in Google Maps.</small>
    </div>
    <a target="_blank" rel="noopener noreferrer">Open in Maps ↗</a>
  `;
  const link = card.querySelector<HTMLAnchorElement>("a");
  if (link) link.href = mapSearchUrl(projectName, location);
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

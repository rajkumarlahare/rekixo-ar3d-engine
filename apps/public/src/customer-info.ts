import type { Public3DExperience } from "@rekixo/3d-contracts";
import { projectSlugFromPathname } from "@rekixo/3d-engine-core";
import { loadPublicExperience } from "./api";

const FLATS_MODE_INDEX = 4;
const INFO_MODE_INDEX = 10;

type UnitFact = { series: string; type: string; areaSqFt: number };
type NearbyFact = { name: string; distance: string };

type ProjectSettings = {
  headline?: string;
  brochurePrice?: string;
  exteriorRenderKey?: string;
  brochureCoverKey?: string;
};

type FloorSettings = {
  title?: string;
  mediaKey?: string;
  floors?: number[];
  units?: UnitFact[];
};

type AmenitySettings = {
  amenities?: string[];
  nearby?: NearbyFact[];
};

type LocationSettings = {
  title?: string;
  mapQuery?: string;
  nearby?: NearbyFact[];
};

type CustomerUi = {
  flatCard: HTMLDivElement;
  flatImage: HTMLImageElement;
  flatImageWrap: HTMLDivElement;
  flatKicker: HTMLElement;
  flatTitle: HTMLElement;
  flatType: HTMLElement;
  flatArea: HTMLElement;
  flatHint: HTMLElement;
  infoCard: HTMLDivElement;
  infoImage: HTMLImageElement;
  infoImageWrap: HTMLDivElement;
  infoTitle: HTMLElement;
  infoLocation: HTMLElement;
  infoOffer: HTMLElement;
  infoFacts: HTMLDivElement;
  infoNearby: HTMLDivElement;
  mapsLink: HTMLAnchorElement;
};

function sceneSettings<T>(experience: Public3DExperience, type: string): T {
  const scene = experience.scenes?.find((item) => item.type === type);
  return (scene?.settings ?? {}) as T;
}

function mediaUrl(experience: Public3DExperience, key?: string) {
  if (!key || !experience.mediaBaseUrl) return undefined;
  const fileName = key.split("/").pop();
  return fileName
    ? `${experience.mediaBaseUrl}/${encodeURIComponent(fileName)}`
    : undefined;
}

function railMode(stage: HTMLElement) {
  const buttons = Array.from(
    stage.querySelectorAll<HTMLButtonElement>(".twin-rail-item"),
  );
  return buttons.findIndex((button) =>
    button.classList.contains("twin-rail-item--active"),
  ) + 1;
}

function selectedFloor(stage: HTMLElement) {
  const selected = stage.querySelector<HTMLButtonElement>(
    ".twin-floor-strip button.active",
  );
  const label = selected?.textContent?.trim().toUpperCase();
  if (!label || label === "ALL") return null;
  if (label === "G") return 0;
  const upper = label.match(/^F(\d+)$/);
  if (upper) return Number(upper[1]);
  const basement = label.match(/^B(\d+)$/);
  if (basement) return -Number(basement[1]);
  return null;
}

function selectedFlat(stage: HTMLElement) {
  const selected = stage.querySelector<HTMLButtonElement>(
    ".twin-unit-list button.active",
  );
  const text = selected?.querySelector("span")?.textContent ?? "";
  const match = text.match(/Flat\s+(.+)/i);
  return match?.[1]?.trim();
}

function unitNumberForFloor(series: string, floor: number) {
  const match = series.match(/^(\d{3})\s+to\s+(\d{3})$/i);
  if (!match) return series;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const candidate = floor * 100 + (start % 100);
  return candidate >= start && candidate <= end ? String(candidate) : null;
}

function visibleUnits(settings: FloorSettings, floor: number | null) {
  if (floor === null) return [];
  return (settings.units ?? [])
    .map((unit) => ({
      ...unit,
      number: unitNumberForFloor(unit.series, floor),
    }))
    .filter((unit) => unit.number);
}

function fact(label: string, value: string) {
  const item = document.createElement("div");
  const key = document.createElement("span");
  key.textContent = label;
  const data = document.createElement("strong");
  data.textContent = value;
  item.append(key, data);
  return item;
}

function createCustomerUi(stage: HTMLElement): CustomerUi {
  const flatCard = document.createElement("div");
  flatCard.className = "twin-flat-detail-card";
  flatCard.hidden = true;

  const flatImageWrap = document.createElement("div");
  flatImageWrap.className = "twin-flat-detail-card__media";
  const flatImage = document.createElement("img");
  flatImage.alt = "Published floor plan";
  flatImage.loading = "lazy";
  flatImageWrap.append(flatImage);

  const flatCopy = document.createElement("div");
  flatCopy.className = "twin-flat-detail-card__copy";
  const flatKicker = document.createElement("span");
  flatKicker.textContent = "FLAT DETAILS";
  const flatTitle = document.createElement("strong");
  const flatType = document.createElement("b");
  const flatArea = document.createElement("em");
  const flatHint = document.createElement("small");
  flatCopy.append(flatKicker, flatTitle, flatType, flatArea, flatHint);
  flatCard.append(flatImageWrap, flatCopy);

  const infoCard = document.createElement("div");
  infoCard.className = "twin-project-info-card";
  infoCard.hidden = true;

  const infoImageWrap = document.createElement("div");
  infoImageWrap.className = "twin-project-info-card__media";
  const infoImage = document.createElement("img");
  infoImage.alt = "Published project reference";
  infoImage.loading = "lazy";
  infoImageWrap.append(infoImage);

  const infoCopy = document.createElement("div");
  infoCopy.className = "twin-project-info-card__copy";
  const infoKicker = document.createElement("span");
  infoKicker.textContent = "PROJECT INFO";
  const infoTitle = document.createElement("strong");
  const infoLocation = document.createElement("p");
  const infoOffer = document.createElement("b");
  const infoFacts = document.createElement("div");
  infoFacts.className = "twin-project-info-card__facts";
  const infoNearby = document.createElement("div");
  infoNearby.className = "twin-project-info-card__nearby";
  const mapsLink = document.createElement("a");
  mapsLink.target = "_blank";
  mapsLink.rel = "noopener noreferrer";
  mapsLink.textContent = "Open in Maps";
  infoCopy.append(
    infoKicker,
    infoTitle,
    infoLocation,
    infoOffer,
    infoFacts,
    infoNearby,
    mapsLink,
  );
  infoCard.append(infoImageWrap, infoCopy);

  stage.append(flatCard, infoCard);
  return {
    flatCard,
    flatImage,
    flatImageWrap,
    flatKicker,
    flatTitle,
    flatType,
    flatArea,
    flatHint,
    infoCard,
    infoImage,
    infoImageWrap,
    infoTitle,
    infoLocation,
    infoOffer,
    infoFacts,
    infoNearby,
    mapsLink,
  };
}

function setImage(
  image: HTMLImageElement,
  wrapper: HTMLElement,
  source?: string,
) {
  wrapper.hidden = !source;
  if (source) image.src = source;
  else image.removeAttribute("src");
}

function bindCustomerInfo(
  stage: HTMLElement,
  experience: Public3DExperience,
) {
  if (stage.dataset.customerInfoBound === "true") return;
  stage.dataset.customerInfoBound = "true";

  const projectSettings = sceneSettings<ProjectSettings>(
    experience,
    "project-navigation",
  );
  const floorSettings = sceneSettings<FloorSettings>(experience, "typical-floor");
  const amenitySettings = sceneSettings<AmenitySettings>(experience, "amenity");
  const locationSettings = sceneSettings<LocationSettings>(experience, "wing-distance");
  const ui = createCustomerUi(stage);
  const floorPlan = mediaUrl(experience, floorSettings.mediaKey);
  const projectImage = mediaUrl(
    experience,
    projectSettings.brochureCoverKey ?? projectSettings.exteriorRenderKey,
  );

  setImage(ui.flatImage, ui.flatImageWrap, floorPlan);
  setImage(ui.infoImage, ui.infoImageWrap, projectImage);

  ui.infoTitle.textContent = projectSettings.headline ?? experience.project.name;
  ui.infoLocation.textContent = experience.project.location ?? "Location not provided";
  ui.infoOffer.textContent = projectSettings.brochurePrice ?? "";
  ui.infoOffer.hidden = !projectSettings.brochurePrice;

  const amenities = amenitySettings.amenities ?? [];
  ui.infoFacts.replaceChildren();
  if (floorSettings.floors?.length) {
    ui.infoFacts.append(fact("Residential floors", String(floorSettings.floors.length)));
  }
  if (floorSettings.units?.length) {
    ui.infoFacts.append(fact("Flat types", String(floorSettings.units.length)));
  }
  if (amenities.length) {
    ui.infoFacts.append(fact("Amenities", String(amenities.length)));
  }

  const nearby = locationSettings.nearby ?? amenitySettings.nearby ?? [];
  ui.infoNearby.replaceChildren();
  nearby.slice(0, 4).forEach((item) => {
    const row = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = item.name;
    const distance = document.createElement("strong");
    distance.textContent = item.distance;
    row.append(name, distance);
    ui.infoNearby.append(row);
  });
  ui.infoNearby.hidden = nearby.length === 0;

  const mapQuery = locationSettings.mapQuery || [
    experience.project.name,
    experience.project.location,
  ].filter(Boolean).join(" ");
  ui.mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;

  let destroyed = false;
  const sync = () => {
    if (destroyed) return;
    const mode = railMode(stage);
    const flatsMode = mode === FLATS_MODE_INDEX;
    const infoMode = mode === INFO_MODE_INDEX;
    ui.flatCard.hidden = !flatsMode;
    ui.infoCard.hidden = !infoMode;

    if (flatsMode) {
      const floor = selectedFloor(stage);
      const units = visibleUnits(floorSettings, floor);
      const selectedNumber = selectedFlat(stage);
      const selectedUnit = units.find((item) => item.number === selectedNumber);

      ui.flatKicker.textContent = floor === null
        ? "FLAT DETAILS"
        : floor === 0
          ? "GROUND FLOOR"
          : `FLOOR ${floor}`;

      if (selectedUnit) {
        ui.flatTitle.textContent = `Flat ${selectedUnit.number}`;
        ui.flatType.textContent = selectedUnit.type;
        ui.flatArea.textContent = `${selectedUnit.areaSqFt.toLocaleString("en-IN")} sq.ft.`;
        ui.flatHint.textContent = floorPlan
          ? "Published floor plan · unit data from project information"
          : "Unit data from published project information";
      } else if (floor !== null && units.length) {
        ui.flatTitle.textContent = "Choose a flat";
        ui.flatType.textContent = `${units.length} configured option${units.length === 1 ? "" : "s"} on this floor`;
        ui.flatArea.textContent = "";
        ui.flatHint.textContent = floorPlan
          ? "Floor plan available · select a flat for type and area"
          : "Select a flat for type and area";
      } else {
        ui.flatTitle.textContent = "Select a floor";
        ui.flatType.textContent = "";
        ui.flatArea.textContent = "";
        ui.flatHint.textContent = "Only published project information is shown.";
      }
    }
  };

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
  });
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });
}

async function startCustomerInfo() {
  const slug = projectSlugFromPathname(window.location.pathname);
  if (!slug) return;
  const controller = new AbortController();
  try {
    const experience = await loadPublicExperience(slug, controller.signal);
    const bindExisting = () => {
      document.querySelectorAll<HTMLElement>(".twin-stage").forEach((stage) =>
        bindCustomerInfo(stage, experience),
      );
    };
    const rootObserver = new MutationObserver(bindExisting);
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
    bindExisting();
    window.addEventListener("pagehide", () => {
      controller.abort();
      rootObserver.disconnect();
    }, { once: true });
  } catch {
    controller.abort();
  }
}

void startCustomerInfo();

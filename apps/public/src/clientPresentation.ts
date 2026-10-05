import type { Public3DExperience, Scene3DType } from "@rekixo/3d-contracts";

export interface BuildingPresentation {
  style?: string;
  description?: string;
  location?: { latitude?: number; longitude?: number; address?: string };
  gallery?: Array<{ mediaKey: string; caption: string }>;
  contact?: { label?: string; phone?: string; email?: string };
}

export function buildingPresentation(experience: Public3DExperience): BuildingPresentation {
  const settings = experience.scenes?.find((scene) => scene.type === "project-navigation")?.settings;
  const value = settings?.presentation;
  return value && typeof value === "object" ? value as BuildingPresentation : {};
}

export function availableClientModules(experience: Public3DExperience, types: Scene3DType[]) {
  return types.filter((type) => experience.scenes?.some((scene) => scene.type === type && scene.enabled));
}

export function exactMapLinks(location: BuildingPresentation["location"]) {
  if (!location) return undefined;
  const { latitude, longitude } = location;
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  const query = encodeURIComponent(`${latitude},${longitude}`);
  return {
    open: `https://www.google.com/maps/search/?api=1&query=${query}`,
    embed: `https://maps.google.com/maps?q=${query}&z=16&output=embed`,
  };
}

export function publishedMediaUrl(base: string | undefined, key: string | undefined) {
  if (!base || !key || !/^[a-zA-Z0-9_./ -]+$/.test(key)) return undefined;
  const name = key.split("/").pop();
  if (!name || name === "." || name === "..") return undefined;
  return `${base}/${encodeURIComponent(name)}`;
}

export function contactLinks(contact: BuildingPresentation["contact"]) {
  const phone = typeof contact?.phone === "string" ? contact.phone.replace(/[\s()-]/g, "") : "";
  const email = typeof contact?.email === "string" ? contact.email : "";
  return {
    phone: /^\+?\d{7,15}$/.test(phone) ? `tel:${phone}` : undefined,
    email: /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email) ? `mailto:${email}` : undefined,
  };
}

export function clientViewerCapabilities(experience: Public3DExperience) {
  const floors = Boolean(experience.scenes?.some((scene) => scene.type === "typical-floor" && scene.enabled));
  return { floors, walk: floors || Boolean(experience.walkthrough?.rooms.length) };
}

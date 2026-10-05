import * as THREE from "three";

export interface SourcePresentation {
  format: "rekixo-public-presentation-v1";
  releaseManifestSha256: string;
  modelId: string;
  modelSha256: string;
  sourceArchiveSha256: string;
  heroDirection?: [number, number, number];
  materials: Array<{ name: string; color: string; opacity?: number; texture?: string; sourcePath: string }>;
  gallery?: Array<{ asset: string; caption: string }>;
}

export function parseSourcePresentation(value: unknown, releaseSha: string, modelId: string): SourcePresentation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as SourcePresentation;
  if (data.format !== "rekixo-public-presentation-v1" || data.releaseManifestSha256 !== releaseSha || data.modelId !== modelId || !/^[a-f0-9]{64}$/.test(data.modelSha256) || !/^[a-f0-9]{64}$/.test(data.sourceArchiveSha256) || !Array.isArray(data.materials) || data.materials.length > 250) return undefined;
  if (data.heroDirection && (!Array.isArray(data.heroDirection) || data.heroDirection.length !== 3 || !data.heroDirection.every((v) => typeof v === "number" && Number.isFinite(v)) || Math.hypot(data.heroDirection[0], data.heroDirection[2]) < 0.01)) return undefined;
  if (data.materials.some((item) => !item || typeof item.name !== "string" || !/^#[a-f0-9]{6}$/i.test(item.color) || typeof item.sourcePath !== "string" || (item.texture !== undefined && !/^[a-f0-9]{20}\.webp$/.test(item.texture)) || (item.opacity !== undefined && (!Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 1)))) return undefined;
  if (data.gallery !== undefined && (!Array.isArray(data.gallery) || data.gallery.length > 30 || data.gallery.some((item) => !item || typeof item.caption !== "string" || !/^[a-z0-9-]+\.webp$/.test(item.asset)))) return undefined;
  return data;
}

export function presentationAssetBase(source: SourcePresentation) {
  return `/3Dprojects/presentations/${source.releaseManifestSha256}`;
}

/** Recovered bytes are opt-in and are applied only to the exact immutable model digest. */
export async function applySourcePresentation(
  root: THREE.Object3D,
  source: SourcePresentation,
  modelBytes: ArrayBuffer,
  renderer: THREE.WebGLRenderer,
  disposed: () => boolean,
) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", modelBytes)), (v) => v.toString(16).padStart(2, "0")).join("");
  if (disposed() || digest !== source.modelSha256) return;
  const definitions = new Map(source.materials.map((item) => [item.name, item]));
  const materials = new Set<THREE.MeshStandardMaterial>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const item of Array.isArray(node.material) ? node.material : [node.material]) {
      if (item instanceof THREE.MeshStandardMaterial && definitions.has(item.name)) materials.add(item);
    }
  });
  const textures = new Map<string, THREE.Texture>();
  const base = presentationAssetBase(source);
  await Promise.all([...new Set(source.materials.flatMap((item) => item.texture ? [item.texture] : []))].map(async (name) => {
    try {
      const texture = await new THREE.TextureLoader().loadAsync(`${base}/${name}`);
      if (disposed()) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
      textures.set(name, texture);
    } catch { /* Preserve original material if an optional recovered bitmap fails. */ }
  }));
  if (disposed()) { textures.forEach((texture) => texture.dispose()); return; }
  const replaced = new Set<THREE.Texture>();
  const used = new Set<THREE.Texture>();
  for (const material of materials) {
    const item = definitions.get(material.name)!;
    material.color.set(item.color);
    if (item.opacity !== undefined) {
      material.opacity = item.opacity;
      material.transparent = item.opacity < 0.999;
      material.depthWrite = item.opacity >= 0.999;
    }
    const texture = item.texture ? textures.get(item.texture) : undefined;
    if (texture) {
      if (material.map) replaced.add(material.map);
      material.map = texture;
      used.add(texture);
    }
    material.userData.recoveredSourceMaterial = { archiveSha256: source.sourceArchiveSha256, path: item.sourcePath };
    material.needsUpdate = true;
  }
  // Dispose placeholder images only if no remaining material references them.
  const remaining = new Set<THREE.Texture>();
  root.traverse((node) => { if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material.map) remaining.add(material.map); });
  replaced.forEach((texture) => { if (!remaining.has(texture)) texture.dispose(); });
  textures.forEach((texture) => { if (!used.has(texture)) texture.dispose(); });
}

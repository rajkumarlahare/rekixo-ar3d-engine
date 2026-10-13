import * as THREE from "three";

export type ProceduralSurfaceKind = "asphalt" | "paving" | "grass" | "soil";

const textureCache = new Map<ProceduralSurfaceKind, THREE.DataTexture>();
const TEXTURE_SIZE = 128;
let configuredAnisotropy = 1;

/** Configure cached and future detail maps for oblique camera angles. */
export function configureProceduralSurfaceTextures(renderer: THREE.WebGLRenderer) {
  configuredAnisotropy = Math.max(
    1,
    Math.min(renderer.capabilities.getMaxAnisotropy(), 8),
  );
  for (const texture of textureCache.values()) {
    if (texture.anisotropy === configuredAnisotropy) continue;
    texture.anisotropy = configuredAnisotropy;
    texture.needsUpdate = true;
  }
}

function unitNoise(x: number, y: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

/**
 * Small deterministic, tileable grayscale detail maps keep default outdoor
 * surfaces from looking like single-color CAD primitives. Texture data is
 * generated locally: no network dependency, customer source data or random
 * runtime seed is involved.
 */
export function proceduralSurfaceTexture(kind: ProceduralSurfaceKind) {
  const cached = textureCache.get(kind);
  if (cached) return cached;

  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const seed =
    kind === "asphalt" ? 1 :
    kind === "paving" ? 2 :
    kind === "grass" ? 3 : 4;

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const index = (y * TEXTURE_SIZE + x) * 4;
      const coarse = unitNoise(Math.floor(x / 8), Math.floor(y / 8), seed);
      const fine = unitNoise(x, y, seed + 17);
      const speckle = unitNoise(
        Math.floor(x / (kind === "paving" ? 16 : 3)),
        Math.floor(y / (kind === "paving" ? 16 : 3)),
        seed + 29,
      );
      const amount =
        kind === "asphalt"
          ? 174 + coarse * 18 + fine * 10 + speckle * 5
          : kind === "paving"
            ? 188 + coarse * 18 + fine * 8 + speckle * 5
            : kind === "grass"
              ? 164 + coarse * 30 + fine * 10 + speckle * 5
              : 170 + coarse * 28 + fine * 10 + speckle * 5;
      const value = Math.max(0, Math.min(255, Math.round(amount)));
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    pixels,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    THREE.RGBAFormat,
  );
  texture.name = `rekixo-environment-${kind}-detail-v1`;
  // This cached texture is shared across viewers and must outlive a single viewer.
  texture.userData.rekixoSharedResource = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.anisotropy = configuredAnisotropy;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  textureCache.set(kind, texture);
  return texture;
}

export function createProceduralSurfaceMaterial(
  color: string,
  kind: ProceduralSurfaceKind,
  roughness = 0.9,
  metalness = 0,
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    map: proceduralSurfaceTexture(kind),
  });
}

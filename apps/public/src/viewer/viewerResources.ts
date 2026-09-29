import * as THREE from "three";

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  const materials = Array.isArray(material) ? material : [material];
  const textures = new Set<THREE.Texture>();
  for (const item of materials) {
    for (const value of Object.values(item))
      if (value instanceof THREE.Texture) textures.add(value);
    item.dispose();
  }
  for (const texture of textures) texture.dispose();
}

export function disposeViewerObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material | THREE.Material[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry) geometries.add(object.geometry);
    materials.add(object.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) disposeMaterial(material);
}

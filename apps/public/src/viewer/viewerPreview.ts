import * as THREE from "three";

export function createPreviewBuilding() {
  const group = new THREE.Group();
  group.name = "Rekixo AR3D preview geometry";

  const wall = new THREE.MeshStandardMaterial({
    color: 0xe8edf2,
    roughness: 0.72,
    metalness: 0.02,
  });
  const frame = new THREE.MeshStandardMaterial({
    color: 0x26313d,
    roughness: 0.52,
    metalness: 0.12,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x8fc8dd,
    roughness: 0.18,
    transmission: 0.24,
    transparent: true,
    opacity: 0.78,
  });
  const warm = new THREE.MeshStandardMaterial({
    color: 0xf0c3a3,
    emissive: 0x9b4d24,
    emissiveIntensity: 0.22,
    roughness: 0.76,
  });

  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(7.4, 0.8, 5.2),
    frame,
  );
  podium.position.y = 0.4;
  podium.castShadow = true;
  podium.receiveShadow = true;
  group.add(podium);

  for (let floor = 0; floor < 5; floor += 1) {
    const y = 1.3 + floor * 1.55;
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(6.6, 1.35, 4.45),
      wall,
    );
    core.position.y = y;
    core.castShadow = true;
    core.receiveShadow = true;
    group.add(core);

    const balcony = new THREE.Mesh(
      new THREE.BoxGeometry(4.5, 0.18, 1.05),
      frame,
    );
    balcony.position.set(0.7, y - 0.25, 2.55);
    balcony.castShadow = true;
    group.add(balcony);

    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(4.1, 0.72, 0.08),
      warm,
    );
    glow.position.set(0.7, y + 0.08, 2.09);
    group.add(glow);

    for (const x of [-2.1, 0, 2.1]) {
      const windowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.15, 0.78, 0.08),
        glass,
      );
      windowMesh.position.set(x, y + 0.06, 2.27);
      group.add(windowMesh);
    }
  }

  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(6.9, 0.35, 4.7),
    frame,
  );
  crown.position.y = 8.75;
  crown.castShadow = true;
  group.add(crown);

  return group;
}

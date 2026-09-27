import * as THREE from "three";

function noise(x: number, y: number) {
  const hash = (a: number, b: number) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = x - ix, ty = y - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx), THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy);
}

export function createReferenceSky(night: boolean) {
  const width = 512, height = 256;
  const pixels = new Uint8Array(width * height * 4);
  const top = new THREE.Color(night ? 0x172439 : 0x506987);
  const horizon = new THREE.Color(night ? 0x54596e : 0xbac1bf);
  const cloud = new THREE.Color(night ? 0x767488 : 0xd1cec7);
  const color = new THREE.Color();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = y / height;
    let f = 0, amplitude = 0.5, frequency = 1;
    for (let oct = 0; oct < 5; oct++) { f += amplitude * noise(x / 95 * frequency, y / 60 * frequency); amplitude *= 0.5; frequency *= 2.03; }
    const clouds = THREE.MathUtils.smoothstep(f, 0.40, 0.76) * 0.74;
    color.copy(horizon).lerp(top, Math.pow(v, 0.65)).lerp(cloud, clouds);
    const i = (y * width + x) * 4;
    pixels[i] = Math.round(THREE.MathUtils.clamp(color.r, 0, 1) * 255);
    pixels[i + 1] = Math.round(color.g * 255); pixels[i + 2] = Math.round(color.b * 255); pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function addReferencePlanting(root: THREE.Object3D) {
  const group = new THREE.Group();
  group.name = "Reference landscape outside source compound";
  root.add(group);
  const surfacing = (name: string, inner: number, outer: number, material: THREE.Material, y: number) => {
    const points = [[1.91 - inner, y, -26.076], [8.437 - inner, y, -4.572], [8.437 - outer, y, -3.8], [1.91 - outer, y, -26.076]];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex([0, 2, 1, 0, 3, 2]); geometry.computeVertexNormals();
    material.side = THREE.DoubleSide; material.userData.referenceFinish = true;
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.receiveShadow = true; mesh.userData.staticSiteContext = true; group.add(mesh);
  };
  surfacing("Footpath beside source boundary", 0.15, 1.45, new THREE.MeshStandardMaterial({color:0x9e9688,roughness:0.92}), 0.29);
  surfacing("Street context outside source boundary", 1.45, 7.5, new THREE.MeshStandardMaterial({color:0x343238,roughness:0.96}), 0.19);
  let seed = 4567;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const leafGeometry = new THREE.IcosahedronGeometry(1, 1);
  const leaves = new THREE.MeshStandardMaterial({ color: 0x576b27, roughness: 0.94 });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x665344, roughness: 1 });
  leaves.userData.referenceFinish = true;
  trunkMaterial.userData.referenceFinish = true;
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  function tree(x: number, z: number, height: number, wide = false) {
    const count = wide ? 2200 : 850;
    const foliage = new THREE.InstancedMesh(leafGeometry, leaves, count);
    foliage.name = wide ? "Broadleaf context tree" : "Conifer beside compound";
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    foliage.userData.staticSiteContext = true;
    for (let i = 0; i < count; i++) {
      const t = random(), angle = random() * Math.PI * 2;
      const radius = (wide ? Math.sqrt(1 - Math.pow(2 * t - 1, 2)) * height * 0.3 : (1 - t) * height * 0.23) * Math.sqrt(random());
      transform.position.set(x + Math.cos(angle) * radius, 0.32 + (wide ? height * 0.45 + t * height * 0.55 : 0.3 + t * height), z + Math.sin(angle) * radius);
      const scale = wide ? height * (0.025 + random() * 0.025) : height * (0.02 + random() * 0.02);
      transform.scale.set(scale * 0.8, scale * (wide ? 0.7 : 1.5), scale);
      transform.rotation.set(random() * 3, random() * 6, random() * 3);
      transform.updateMatrix();
      foliage.setMatrixAt(i, transform.matrix);
      color.setHSL(0.20 + random() * 0.08, 0.34 + random() * 0.2, 0.21 + random() * 0.15);
      foliage.setColorAt(i, color);
    }
    group.add(foliage);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.022, height * 0.036, height * 0.8, 8), trunkMaterial);
    trunk.position.set(x, height * 0.4, z);
    trunk.castShadow = true;
    trunk.userData.staticSiteContext = true;
    group.add(trunk);
  }
  // The left boundary is a sloped line from (1.91,-26.08) to (8.44,-4.57).
  // Planting sits outside that existing wall; the source parcel is unchanged.
  for (const [z, height] of [[-5.6, 3.4], [-10.3, 4.2], [-15.7, 4.6], [-21.4, 4.1]]) {
    const x = 1.91 + (z + 26.076) / 21.504 * 6.527 - 0.7;
    tree(x, z, height);
  }
  tree(-1.5, -21, 9.2, true);
  tree(25.8, -17, 8.5, true);
  tree(23.3, -27.5, 10.2, true);
  // Low flowering vegetation along the wall, batched into two draw calls.
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.055, 0), new THREE.MeshStandardMaterial({ color: 0xd95578, roughness: 0.8 }), 120);
  flowers.userData.staticSiteContext = true;
  flowers.material.userData.referenceFinish = true;
  for (let i = 0; i < 120; i++) {
    const z = -5 - random() * 19;
    const x = 1.91 + (z + 26.076) / 21.504 * 6.527 - 0.35 - random() * 0.35;
    transform.position.set(x, 0.4 + random() * 0.14, z);
    transform.scale.setScalar(1); transform.updateMatrix(); flowers.setMatrixAt(i, transform.matrix);
  }
  group.add(flowers);
  return group;
}

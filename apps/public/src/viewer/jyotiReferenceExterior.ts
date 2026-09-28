import * as THREE from "three";
import { addReferencePlanting, createReferenceSky } from "./jyotiReferenceContext";
import { JYOTI_SOURCE_MODEL_SHA256 } from "./jyotiSourceProfile";

// Coordinates are taken from the supplied FBX, not from the overall site box.
// This look-development pass is restricted to that exact source revision.
const SOURCE = JYOTI_SOURCE_MODEL_SHA256;
const LEVELS = [3.048, 6.0452, 9.0424, 12.0396, 15.0368, 18.034];

function finish(name: string, color: number, roughness = 0.75) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, name });
  m.userData.referenceFinish = true;
  return m;
}

function glazing(name: string, opacity = 0.38) {
  const m = new THREE.MeshPhysicalMaterial({
    name, color: 0xa3bdc6, roughness: 0.13, metalness: 0.18,
    transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    clearcoat: 1, envMapIntensity: 0.7,
  });
  m.userData.referenceFinish = true;
  return m;
}

function box(root: THREE.Object3D, name: string, size: number[], position: number[], material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = !material.transparent;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function brickFinish() {
  const material = finish("Reference brick compound", 0xba6049, 0.94);
  material.onBeforeCompile = shader => {
    shader.vertexShader = "varying vec3 vBrickWorld;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvBrickWorld = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = "varying vec3 vBrickWorld;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      float row = floor(vBrickWorld.y / 0.18);
      vec3 brickNormal = normalize(cross(dFdx(vBrickWorld), dFdy(vBrickWorld)));
      float along = abs(brickNormal.x) > 0.65 ? vBrickWorld.z : vBrickWorld.x;
      vec2 cell = fract(vec2(along / 0.43 + mod(row, 2.0) * 0.5, vBrickWorld.y / 0.18));
      float mortar = max(1.0 - smoothstep(0.025, 0.055, cell.x), 1.0 - smoothstep(0.035, 0.08, cell.y));
      float variation = fract(sin(floor(along / 0.43) * 127.1 + row * 311.7) * 43758.5453);
      diffuseColor.rgb *= 0.88 + variation * 0.20;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.53, 0.49, 0.43), mortar * 0.85);
    `);
  };
  material.customProgramCacheKey = () => "jyoti-reference-brick-v1";
  return material;
}

/** Apply finishes to the existing surfaces and attach details at measured FBX faces. */
export function applyJyotiReferenceExterior(root: THREE.Object3D) {
  let matched = false;
  root.traverse(node => { if (node.userData.sourceGeometry?.sha256 === SOURCE) matched = true; });
  if (!matched) return undefined;
  const floorLevels = [0, ...LEVELS];
  root.userData.architecturalFloorLevels = floorLevels;

  const plaster = finish("Reference warm ivory plaster", 0xe8ded0, 0.87);
  const charcoal = finish("Reference charcoal frames", 0x3e474b, 0.68);
  const wood = finish("Reference warm timber cladding", 0x735347, 0.72);
  const bronze = finish("Reference window surround", 0x725043, 0.55);
  const black = finish("Reference dark mullions", 0x242b30, 0.43);
  const silver = finish("Reference satin railing", 0x899b9f, 0.3);
  silver.metalness = 0.55;
  const glass = glazing("Reference balcony glazing");
  const window = glazing("Reference blue window glass", 0.7);
  const bricks = brickFinish();
  const paving = finish("Reference warm paving", 0x88786c, 0.95);
  const glowing = finish("Reference recessed warm white LED", 0xffead2, 0.4);
  glowing.emissive.setHex(0xffd0a0);
  glowing.emissiveIntensity = 3.4;
  const sourceNames = (node: THREE.Object3D) => {
    const names: string[] = [];
    for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) names.push(parent.name);
    return names;
  };
  const retiredMaterials = new Set<THREE.Material>();

  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const names = sourceNames(node);
    const is = (name: string) => names.includes(name);
    const original = Array.isArray(node.material) ? node.material : [node.material];
    const calibrated = original.map(material => {
      retiredMaterials.add(material);
      const name = material.name.toLowerCase();
      if (is("Mesh36")) return bricks;
      if (name === "tile_large_brown") return paving;
      if (is("Mesh196") && name === "field_square_tile") return window;
      if (is("Mesh195") || (is("Mesh196") && name === "granite_tile")) return black;
      if (is("Mesh913") && name === "marble_carrara_floor_tile") return charcoal;
      if (name === "marble_carrara_floor_tile" || name === "frontcolor" || name === "white_subway_tile" || name === "tile_border_travertine") return plaster;
      if (name === "tile_canvas" || name === "color_m06") return charcoal;
      if (name === "concrete_pavers_block_multi" || name === "translucent_glass_blue") return window;
      if (name === "roofing_slate_tan" || name === "ornate_tile_01") return glass;
      if (name === "basic_tile" || name === "granite_tile") return black;
      if (name === "concrete_tile" || name === "encaustic_tile_circular_01") return bronze;
      if (name === "encaustic_tile_circular_02" || name === "herringbone" || name === "metal_panel" || name === "color_a06") return wood;
      if (name === "slate" || name === "slate_light_tile") return silver;
      return plaster;
    });
    node.material = Array.isArray(node.material) ? calibrated : calibrated[0];
  });
  for (const material of retiredMaterials) material.dispose();

  const details = new THREE.Group();
  details.name = "Jyoti reference elevation details";
  root.add(details);
  addReferencePlanting(details);
  const lights: THREE.PointLight[] = [];
  const leafMaterial = finish("Reference balcony planting", 0x64704b, 0.95);
  const potMaterial = finish("Reference balcony planter", 0x867d6a, 0.9);
  const leafGeometry = new THREE.SphereGeometry(1, 5, 4);
  // Main wing returns around the actual x=9.79 and z=-3.09 balcony faces.
  // Frames alternate F2/F4; F1/F3/F5 carry the fine vertical corner screen.
  for (let floor = 0; floor < 5; floor++) {
    const y = LEVELS[floor];
    const ceiling = LEVELS[floor + 1] - 0.12;
    const floorRoot = new THREE.Group();
    floorRoot.name = `Reference details floor ${floor + 1}`;
    details.add(floorRoot);
    for (const [x, z] of [[10.35, -9.48], [11.60, -3.70], [9.00, -15.25]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.25, 10), potMaterial);
      pot.position.set(x, y + 0.38, z); floorRoot.add(pot);
      const foliage = new THREE.InstancedMesh(leafGeometry, leafMaterial, 35);
      const leaf = new THREE.Object3D();
      for (let i = 0; i < 35; i++) {
        const angle = i * 2.39996;
        const height = (i % 7) / 7;
        leaf.position.set(x + Math.cos(angle) * (0.07 + height * 0.15), y + 0.52 + height * 0.48, z + Math.sin(angle) * (0.07 + height * 0.15));
        leaf.scale.set(0.04, 0.09, 0.025); leaf.rotation.set(angle, height, angle * 0.3);
        leaf.updateMatrix(); foliage.setMatrixAt(i, leaf.matrix);
      }
      floorRoot.add(foliage);
    }
    // Recessed timber soffits sit under the existing balcony slabs.
    box(floorRoot, "Main balcony timber soffit", [1.27, 0.05, 3.06], [10.51, ceiling, -8.30], wood);
    box(floorRoot, "Corner return timber soffit", [5.62, 0.05, 1.22], [14.08, ceiling, -3.81], wood);
    for (let strip = 0; strip < 9; strip++) {
      box(floorRoot, "Timber soffit seam", [0.022, 0.012, 3.04], [9.94 + strip * 0.14, ceiling - 0.03, -8.30], black);
      box(floorRoot, "Return soffit seam", [5.6, 0.012, 0.022], [14.08, ceiling - 0.03, -3.26 - strip * 0.14], black);
    }
    box(floorRoot, "Side balcony LED", [0.028, 0.025, 2.96], [9.96, ceiling - 0.047, -8.30], glowing);
    box(floorRoot, "Return balcony LED", [5.48, 0.025, 0.028], [14.08, ceiling - 0.047, -3.28], glowing);
    for (const [x, z] of [[10.48, -7.3], [10.48, -9.2], [12.2, -3.78], [15.8, -3.78]]) {
      const downlight = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 12), glowing);
      downlight.position.set(x, ceiling - 0.043, z);
      downlight.name = "Recessed balcony downlight";
      floorRoot.add(downlight);
    }
    const light = new THREE.PointLight(0xffba80, 22, 5.5, 2);
    light.position.set(10.55, ceiling - 0.27, -8.3);
    floorRoot.add(light);
    lights.push(light);
    const returnLight = new THREE.PointLight(0xffb47b, 26, 5.5, 2);
    returnLight.position.set(14.0, ceiling - 0.27, -3.85);
    floorRoot.add(returnLight);
    lights.push(returnLight);
    // Smaller left-hand balcony stack beside the central glazing.
    box(floorRoot, "Left balcony soffit", [1.30, 0.045, 3.08], [9.12, ceiling, -14.09], wood);
    box(floorRoot, "Left balcony clear pane", [0.025, 0.85, 3.10], [8.43, y + 0.75, -14.09], glass);
    box(floorRoot, "Left balcony handrail", [0.045, 0.045, 3.18], [8.43, y + 1.18, -14.09], silver);
    const leftLight = new THREE.PointLight(0xffbb88, 23, 5, 2);
    leftLight.position.set(9.12, ceiling - 0.26, -14.09);
    floorRoot.add(leftLight);
    lights.push(leftLight);
    for (const z of [-13.1, -15.0]) {
      const light = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.018, 12), glowing);
      light.position.set(9.12, ceiling - 0.04, z);
      floorRoot.add(light);
    }
    if (floor % 2 === 0) {
      for (const yy of [y + 0.10, LEVELS[floor + 1] - 0.05]) box(floorRoot, "Left charcoal horizontal frame", [0.26, 0.27, 3.46], [8.40, yy, -14.09], charcoal);
      for (const z of [-15.69, -12.49]) box(floorRoot, "Left charcoal vertical frame", [0.26, 3.0, 0.26], [8.40, y + 1.50, z], charcoal);
    }
    // Cut cladding around (rather than over) the original left bedroom window.
    for (const z of [-20.89, -18.58]) box(floorRoot, "Left bedroom cladding jamb", [0.075, 3.0, 0.48], [6.56, y + 1.5, z], charcoal);
    box(floorRoot, "Left bedroom cladding base", [0.075, 0.70, 2.8], [6.56, y + 0.35, -19.74], charcoal);
    box(floorRoot, "Left bedroom cladding lintel", [0.075, 0.46, 2.8], [6.56, y + 2.77, -19.74], charcoal);
    // Clear panes replace the opaque-looking CAD parapet finish, at its own faces.
    box(floorRoot, "Main balcony clear pane", [0.025, 0.83, 3.00], [9.91, y + 0.74, -8.30], glass);
    box(floorRoot, "Main balcony handrail", [0.045, 0.045, 3.10], [9.91, y + 1.18, -8.30], silver);
    box(floorRoot, "Return balcony clear pane", [5.60, 0.83, 0.025], [14.09, y + 0.74, -3.15], glass);
    box(floorRoot, "Return balcony handrail", [5.68, 0.045, 0.045], [14.09, y + 1.18, -3.15], silver);
    if (floor % 2 === 1) {
      // Flush edges, not an offset enclosure. No panel closes the balcony opening.
      for (const level of [y + 0.10, LEVELS[floor + 1] - 0.05]) {
        box(floorRoot, "Charcoal balcony horizontal edge", [0.28, 0.26, 6.94], [9.78, level, -6.49], charcoal);
        box(floorRoot, "Charcoal return horizontal edge", [7.47, 0.26, 0.28], [13.40, level, -3.10], charcoal);
      }
      box(floorRoot, "Charcoal balcony vertical edge", [0.28, 3.02, 0.28], [9.78, y + 1.5, -9.90], charcoal);
      box(floorRoot, "Charcoal return vertical edge", [0.28, 3.02, 0.28], [17.01, y + 1.5, -3.10], charcoal);
    }
    // Wood reveals around the measured bedroom window: x=10.925, z=-6.52..-4.79.
    for (const z of [-6.61, -4.70]) box(floorRoot, "Bedroom window brown jamb", [0.12, 1.93, 0.13], [10.88, y + 1.63, z], bronze);
    for (const yy of [y + 0.665, y + 2.595]) box(floorRoot, "Bedroom window brown lintel", [0.12, 0.13, 2.04], [10.88, yy, -5.655], bronze);
  }
  // Central full-height glazing and its horizontal transoms.
  for (let y = 2.24; y < 19.15; y += 1.50) box(details, "Central glazing transom", [0.036, 0.032, 1.42], [9.833, y, -11.205], black);
  box(details, "Central glazing mullion", [0.036, 16.92, 0.03], [9.833, 10.696, -11.205], black);
  // The reference has a bedroom/cladding pier through the upper terrace.
  // Build the pier around an open window aperture, continuous with its lower stack.
  for (const [z, width] of [[-6.65, 0.26], [-4.62, 0.34]]) box(details, "Upper bedroom cladding jamb", [0.18, 3.91, width], [11.10, 17.247, z], wood);
  box(details, "Upper bedroom cladding below window", [0.18, 0.51, 2.33], [11.10, 15.545, -5.62], wood);
  box(details, "Upper bedroom cladding above window", [0.18, 1.67, 2.33], [11.10, 18.367, -5.62], wood);
  box(details, "Upper bedroom window glass", [0.022, 1.43, 1.43], [10.99, 16.673, -5.655], window);
  for (const z of [-6.39, -5.655, -4.92]) box(details, "Upper bedroom window mullion", [0.045, 1.52, 0.04], [10.97, 16.673, z], black);
  for (const y of [15.913, 17.433]) box(details, "Upper bedroom window transom", [0.045, 0.04, 1.51], [10.97, y, -5.655], black);
  // Quiet cladding joints on the authored brown return, no additional solid slab.
  for (let y = 3.3; y < 19.1; y += 0.36) box(details, "Timber return joint", [2.77, 0.014, 0.016], [19.08, y, -2.970], bronze);
  for (let y = 3.3; y < 18; y += 0.36) box(details, "Bedroom timber joint", [0.012, 0.012, 1.71], [10.86, y, -5.655], bronze);
  // Roof underside perimeter strips follow the measured crown, below y=19.2024.
  box(details, "Roof side LED", [0.028, 0.025, 6.52], [9.91, 18.08, -6.35], glowing);
  box(details, "Roof return LED", [10.04, 0.025, 0.028], [15.21, 18.08, -3.12], glowing);
  const shutter = finish("Reference ground floor shutters", 0x555653, 0.73);
  for (const x of [16.62, 19.05]) {
    box(details, "Ground floor roller shutter", [2.22, 2.16, 0.06], [x, 1.48, -4.56], shutter);
    for (let y = 0.44; y < 2.56; y += 0.16) box(details, "Shutter horizontal slat", [2.18, 0.012, 0.018], [x, y, -4.522], black);
  }

  const daylightSky = createReferenceSky(false);
  const eveningSky = createReferenceSky(true);

  return {
    details,
    floorLevels,
    daylightSky,
    eveningSky,
    dispose() { daylightSky.dispose(); eveningSky.dispose(); },
    setNight(night: boolean) {
      glowing.emissiveIntensity = night ? 5 : 3.4;
      for (const light of lights) light.intensity = night ? 34 : 22;
    },
  };
}

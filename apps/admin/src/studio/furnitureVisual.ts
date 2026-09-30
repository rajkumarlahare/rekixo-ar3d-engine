import * as T from "three";
import { catalog, type Furniture, type Kind } from "./domain";

function material(color: string, roughness = 0.62, metalness = 0) {
  return new T.MeshStandardMaterial({ color, roughness, metalness });
}

function box(
  root: T.Object3D,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  roughness = 0.62,
  metalness = 0,
) {
  const mesh = new T.Mesh(
    new T.BoxGeometry(...size),
    material(color, roughness, metalness),
  );
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function cylinder(
  root: T.Object3D,
  name: string,
  radius: number,
  height: number,
  position: [number, number, number],
  color: string,
  segments = 14,
) {
  const mesh = new T.Mesh(
    new T.CylinderGeometry(radius, radius, height, segments),
    material(color, 0.64),
  );
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function buildSofa(root: T.Object3D, color: string) {
  const c = catalog.sofa;
  const seatHeight = 0.34;
  const cushionDepth = c.depth * 0.68;
  box(root, "Sofa base", [c.width * 0.94, 0.18, c.depth * 0.78], [0, 0.14, 0.03], "#6f5748", 0.72);
  const cushionWidth = c.width * 0.43;
  for (const x of [-c.width * 0.235, c.width * 0.235]) {
    box(root, "Sofa seat cushion", [cushionWidth, 0.18, cushionDepth], [x, seatHeight, 0.05], color, 0.83);
    box(root, "Sofa back cushion", [cushionWidth, 0.46, 0.16], [x, 0.62, -c.depth * 0.34], color, 0.86);
  }
  for (const x of [-c.width / 2 + 0.10, c.width / 2 - 0.10])
    box(root, "Sofa arm", [0.18, 0.48, c.depth * 0.78], [x, 0.43, 0.02], color, 0.78);
  for (const x of [-c.width * 0.39, c.width * 0.39])
    for (const z of [-c.depth * 0.27, c.depth * 0.27])
      box(root, "Sofa leg", [0.07, 0.13, 0.07], [x, 0.065, z], "#49372d", 0.7);
}

function buildBed(root: T.Object3D, color: string) {
  const c = catalog.bed;
  box(root, "Bed frame", [c.width, 0.18, c.depth], [0, 0.12, 0], "#6d5140", 0.72);
  box(root, "Mattress", [c.width * 0.94, 0.24, c.depth * 0.90], [0, 0.32, 0.03], color, 0.88);
  box(root, "Headboard", [c.width, 0.78, 0.10], [0, 0.48, -c.depth / 2 + 0.05], "#765846", 0.7);
  box(root, "Duvet", [c.width * 0.86, 0.07, c.depth * 0.55], [0, 0.485, 0.24], "#e7ddd0", 0.94);
  for (const x of [-c.width * 0.24, c.width * 0.24])
    box(root, "Pillow", [c.width * 0.38, 0.10, 0.34], [x, 0.51, -c.depth * 0.30], "#f5f1e8", 0.95);
}

function buildTable(root: T.Object3D, color: string) {
  const c = catalog.table;
  box(root, "Table top", [c.width, 0.09, c.depth], [0, c.height - 0.06, 0], color, 0.58);
  const legColor = "#5c493d";
  for (const x of [-c.width * 0.39, c.width * 0.39])
    for (const z of [-c.depth * 0.34, c.depth * 0.34])
      box(root, "Table leg", [0.07, c.height - 0.10, 0.07], [x, (c.height - 0.10) / 2, z], legColor, 0.66);
}

function buildWardrobe(root: T.Object3D, color: string) {
  const c = catalog.wardrobe;
  box(root, "Wardrobe carcass", [c.width, c.height, c.depth], [0, c.height / 2, 0], color, 0.72);
  const doorWidth = c.width / 2 - 0.035;
  for (const x of [-c.width * 0.25, c.width * 0.25]) {
    box(root, "Wardrobe door", [doorWidth, c.height * 0.91, 0.025], [x, c.height * 0.51, c.depth / 2 + 0.014], "#9b7b63", 0.64);
  }
  for (const x of [-0.055, 0.055])
    box(root, "Wardrobe handle", [0.025, 0.24, 0.025], [x, c.height * 0.52, c.depth / 2 + 0.035], "#c5a35c", 0.35, 0.55);
}

function buildPlant(root: T.Object3D) {
  const c = catalog.plant;
  const pot = new T.Mesh(
    new T.CylinderGeometry(0.17, 0.13, 0.32, 16),
    material("#8a5f42", 0.84),
  );
  pot.name = "Plant pot";
  pot.position.y = 0.16;
  pot.castShadow = true;
  pot.receiveShadow = true;
  root.add(pot);

  cylinder(root, "Plant stem", 0.035, 0.48, [0, 0.52, 0], "#54683b", 10);
  const leafMaterial = material("#5f8754", 0.86);
  const clusters: Array<[number, number, number, number]> = [
    [0, 0.80, 0, 0.26],
    [-0.14, 0.70, 0.03, 0.20],
    [0.14, 0.69, -0.02, 0.21],
    [0.02, 0.62, 0.14, 0.18],
  ];
  for (const [x, y, z, radius] of clusters) {
    const leaves = new T.Mesh(new T.IcosahedronGeometry(radius, 1), leafMaterial.clone());
    leaves.name = "Plant foliage";
    leaves.position.set(x, y, z);
    leaves.castShadow = true;
    root.add(leaves);
  }
  // Keep the presentation inside the catalog collision envelope.
  root.scale.set(
    Math.min(1, c.width / 0.56),
    Math.min(1, c.height / 1.02),
    Math.min(1, c.depth / 0.56),
  );
}

export function addFurnitureVisual(root: T.Object3D, furniture: Furniture) {
  switch (furniture.kind as Kind) {
    case "sofa":
      buildSofa(root, furniture.color);
      break;
    case "bed":
      buildBed(root, furniture.color);
      break;
    case "table":
      buildTable(root, furniture.color);
      break;
    case "wardrobe":
      buildWardrobe(root, furniture.color);
      break;
    case "plant":
      buildPlant(root);
      break;
  }
}

import * as T from "three";
import type { SiteElement } from "./domain";
import {
  addStructuralElementVisual,
  isStructuralVisual,
} from "./structuralElementVisual";

function material(color: string, roughness = 0.78, metalness = 0) {
  return new T.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
}

function box(
  root: T.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  roughness = 0.78,
  metalness = 0,
) {
  const mesh = new T.Mesh(
    new T.BoxGeometry(...size),
    material(color, roughness, metalness),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function cylinder(
  root: T.Object3D,
  radius: number,
  height: number,
  position: [number, number, number],
  color: string,
  segments = 14,
) {
  const mesh = new T.Mesh(
    new T.CylinderGeometry(radius, radius, height, segments),
    material(color, 0.76),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addArea(root: T.Object3D, item: SiteElement) {
  box(
    root,
    [item.width, Math.max(0.025, item.height), item.depth],
    [0, Math.max(0.0125, item.height / 2), 0],
    item.color,
    item.kind === "road" || item.kind === "parking" ? 0.9 : 0.82,
  );
}

function addTree(root: T.Object3D, item: SiteElement) {
  const trunkHeight = Math.max(0.7, item.height * 0.48);
  const trunkRadius = Math.max(0.06, Math.min(item.width, item.depth) * 0.07);
  cylinder(
    root,
    trunkRadius,
    trunkHeight,
    [0, trunkHeight / 2, 0],
    "#74553b",
    12,
  );
  const crownRadius = Math.max(
    0.25,
    Math.min(item.width, item.depth) * 0.42,
  );
  const foliage = new T.Mesh(
    new T.IcosahedronGeometry(crownRadius, 2),
    material(item.color, 0.88),
  );
  foliage.position.y = Math.max(
    trunkHeight * 0.9,
    item.height - crownRadius * 0.9,
  );
  foliage.scale.y = Math.max(
    0.65,
    Math.min(1.6, item.height / Math.max(item.width, item.depth, 0.1) / 1.7),
  );
  foliage.castShadow = true;
  root.add(foliage);
}

function addPlant(root: T.Object3D, item: SiteElement) {
  const potHeight = Math.min(0.4, item.height * 0.28);
  cylinder(
    root,
    Math.max(0.08, Math.min(item.width, item.depth) * 0.2),
    potHeight,
    [0, potHeight / 2, 0],
    "#876247",
    14,
  );
  const radius = Math.max(
    0.16,
    Math.min(item.width, item.depth, item.height) * 0.38,
  );
  const foliage = new T.Mesh(
    new T.IcosahedronGeometry(radius, 1),
    material(item.color, 0.9),
  );
  foliage.position.y = Math.max(potHeight + radius * 0.7, item.height * 0.62);
  foliage.scale.y = Math.max(0.8, item.height / Math.max(radius * 2, 0.2));
  foliage.castShadow = true;
  root.add(foliage);
}

function addGate(root: T.Object3D, item: SiteElement) {
  const post = Math.max(0.08, Math.min(0.18, item.width * 0.06));
  box(
    root,
    [post, item.height, Math.max(0.08, item.depth)],
    [-item.width / 2 + post / 2, item.height / 2, 0],
    item.color,
    0.5,
    0.28,
  );
  box(
    root,
    [post, item.height, Math.max(0.08, item.depth)],
    [item.width / 2 - post / 2, item.height / 2, 0],
    item.color,
    0.5,
    0.28,
  );
  box(
    root,
    [Math.max(post, item.width - post * 2), Math.max(0.05, item.height * 0.06), Math.max(0.05, item.depth * 0.75)],
    [0, item.height * 0.82, 0],
    item.color,
    0.5,
    0.28,
  );
}

function addOutdoorLight(root: T.Object3D, item: SiteElement) {
  const poleRadius = Math.max(0.035, Math.min(item.width, item.depth) * 0.22);
  cylinder(
    root,
    poleRadius,
    Math.max(0.3, item.height * 0.92),
    [0, item.height * 0.46, 0],
    item.color,
    12,
  );
  const lamp = new T.Mesh(
    new T.SphereGeometry(
      Math.max(0.07, Math.min(item.width, item.depth) * 0.42),
      12,
      8,
    ),
    new T.MeshStandardMaterial({
      color: "#fff3d2",
      emissive: "#ffd48a",
      emissiveIntensity: 1.4,
      roughness: 0.35,
    }),
  );
  lamp.position.y = item.height;
  root.add(lamp);
}

export function addSiteElementVisual(
  root: T.Object3D,
  item: SiteElement,
) {
  if (isStructuralVisual(item)) {
    root.name = "Structural · " + item.kind;
    addStructuralElementVisual(root, item);
    return;
  }

  root.name = "Site · " + item.kind;
  switch (item.kind) {
    case "garden":
    case "lawn":
    case "path":
    case "road":
    case "parking":
      addArea(root, item);
      break;
    case "tree":
      addTree(root, item);
      break;
    case "plant":
      addPlant(root, item);
      break;
    case "gate":
      addGate(root, item);
      break;
    case "outdoor-light":
      addOutdoorLight(root, item);
      break;
  }
}

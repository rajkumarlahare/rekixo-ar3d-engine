import type * as THREE from "three";

export type ExperienceMode = "site" | "interior" | "terrace";

export type ExperienceFeature = {
  id: string;
  label: string;
  category: string;
  description: string;
  object: THREE.Object3D;
};

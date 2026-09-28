import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import {
  applyModelProfileExterior,
  loadModelProfileMaterialEnhancer,
  type ModelProfileRuntime,
} from "../../../public/src/viewer/modelProfiles";
import { asset } from "./storage";
import {
  canWalk,
  catalog,
  type Asset,
  type Scene as SceneData,
} from "./domain";

export type View = "building" | "rooms" | "walk";
export type TransformMode = "translate" | "rotate" | "scale";
export type TransformCommit =
  | {
      kind: "room";
      id: string;
      x?: number;
      z?: number;
      width?: number;
      depth?: number;
      height?: number;
    }
  | {
      kind: "furniture";
      id: string;
      x?: number;
      z?: number;
      rotation?: number;
    };
export interface ModelNodeSummary {
  key: string;
  name: string;
  type: string;
}
export interface ModelMaterialSummary {
  name: string;
  type: string;
  meshCount: number;
  baseColor: string;
  roughness: number;
  metalness: number;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
}
interface Props {
  resolveAsset?: (id: string) => Promise<Asset | undefined>;
  scene: SceneData;
  roomId: string;
  view: View;
  selected: string;
  onSelect: (id: string) => void;
  onMesh: (name: string) => void;
  selectedMesh?: string;
  transformMode?: TransformMode;
  transformEnabled?: boolean;
  snap?: boolean;
  focusRequest?: number;
  onTransformCommit?: (change: TransformCommit) => void;
  onModelNodes?: (nodes: ModelNodeSummary[]) => void;
  onModelMaterials?: (materials: ModelMaterialSummary[]) => void;
  cameraOrientation?: "perspective" | "top";
}
function dispose(root: T.Object3D) {
  const materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((n) => {
    if (n instanceof T.Mesh || n instanceof T.Line) {
      n.geometry.dispose();
      for (const m of Array.isArray(n.material) ? n.material : [n.material])
        materials.add(m);
    }
  });
  for (const m of materials) {
    for (const v of Object.values(m))
      if (v instanceof T.Texture) textures.add(v);
    m.dispose();
  }
  for (const t of textures) t.dispose();
}
function block(
  root: T.Object3D,
  name: string,
  size: number[],
  pos: number[],
  color: string,
) {
  const mesh = new T.Mesh(
    new T.BoxGeometry(...(size as [number, number, number])),
    new T.MeshStandardMaterial({ color, roughness: 0.75 }),
  );
  mesh.name = name;
  mesh.position.set(...(pos as [number, number, number]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

type MaterialBase = {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  emissive: string;
  emissiveIntensity: number;
};

function materialBase(material: T.MeshStandardMaterial): MaterialBase {
  const stored = material.userData.studioMaterialBase as MaterialBase | undefined;
  if (stored) return stored;
  const base: MaterialBase = {
    color: `#${material.color.getHexString()}`,
    roughness: material.roughness,
    metalness: material.metalness,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    emissive: `#${material.emissive.getHexString()}`,
    emissiveIntensity: material.emissiveIntensity,
  };
  material.userData.studioMaterialBase = base;
  return base;
}

function applyModelMaterialOverrides(root: T.Object3D, scene: SceneData) {
  const overrides = new Map(
    (scene.materialOverrides ?? []).map((item) => [item.materialName, item]),
  );
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      const base = materialBase(material);
      material.color.set(base.color);
      material.roughness = base.roughness;
      material.metalness = base.metalness;
      material.opacity = base.opacity;
      material.transparent = base.transparent;
      material.depthWrite = base.depthWrite;
      material.emissive.set(base.emissive);
      material.emissiveIntensity = base.emissiveIntensity;

      const override = overrides.get(material.name);
      if (override) {
        if (override.baseColor) material.color.set(override.baseColor);
        if (override.roughness !== undefined)
          material.roughness = override.roughness;
        if (override.metalness !== undefined)
          material.metalness = override.metalness;
        if (override.opacity !== undefined) {
          material.opacity = override.opacity;
          material.transparent = override.opacity < 0.999;
          material.depthWrite = override.opacity >= 0.999;
        }
        if (override.emissive) material.emissive.set(override.emissive);
        if (override.emissiveIntensity !== undefined)
          material.emissiveIntensity = override.emissiveIntensity;
      }
      material.needsUpdate = true;
    }
  });
}

function summarizeModelMaterials(root: T.Object3D): ModelMaterialSummary[] {
  const rows = new Map<string, ModelMaterialSummary>();
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      const name = material.name || "Unnamed material";
      const current = rows.get(name);
      if (current) {
        current.meshCount += 1;
        continue;
      }
      rows.set(name, {
        name,
        type: material.type,
        meshCount: 1,
        baseColor: `#${material.color.getHexString()}`,
        roughness: material.roughness,
        metalness: material.metalness,
        opacity: material.opacity,
        emissive: `#${material.emissive.getHexString()}`,
        emissiveIntensity: material.emissiveIntensity,
      });
    }
  });
  return [...rows.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export default function SceneCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const api = useRef<{
    scene: T.Scene;
    camera: T.PerspectiveCamera;
    renderer: T.WebGLRenderer;
    controls: OrbitControls;
    model: T.Group;
    rooms: T.Group;
    references: T.Group;
    keys: Set<string>;
    selectables: Map<string, T.Object3D>;
    transform: TransformControls;
    hemi: T.HemisphereLight;
    sun: T.DirectionalLight;
    profileExterior?: ModelProfileRuntime["exterior"];
    modelSelection?: T.BoxHelper;
    focus: () => void;
    focusSelected: () => void;
  } | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const el = host.current!;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true });
    } catch {
      setStatus(
        "WebGL is unavailable. Try a browser with hardware acceleration.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Interactive design canvas");
    renderer.domElement.tabIndex = 0;
    const scene = new T.Scene();
    scene.background = new T.Color("#dbe3e7");
    const camera = new T.PerspectiveCamera(45, 1, 0.05, 2000);
    camera.position.set(12, 12, 14);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI * 0.49;
    const hemi = new T.HemisphereLight(0xffffff, 0x687681, 2.8);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff1db, 3.2);
    sun.position.set(-15, 30, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 30,
      bottom: -30,
    });
    scene.add(sun);
    const grid = new T.GridHelper(100, 100, 0xa9b4bd, 0xcbd3d9);
    grid.position.y = -0.05;
    scene.add(grid);
    const model = new T.Group(),
      rooms = new T.Group(),
      references = new T.Group();
    references.name = "Studio reference layers";
    scene.add(references, model, rooms);
    const keys = new Set<string>();
    const selectables = new Map<string, T.Object3D>();
    const transform = new TransformControls(camera, renderer.domElement);
    scene.add(transform.getHelper());
    const roomFloor = () => {
      const { scene: s, roomId } = latest.current;
      const r = s.rooms.find((r) => r.id === roomId);
      return {
        r,
        y: s.floors.find((f) => f.id === r?.floorId)?.elevation ?? 0,
      };
    };
    let yaw = 0,
      pitch = 0;
    const focus = () => {
      const { r, y } = roomFloor(),
        { view } = latest.current;
      keys.clear();
      if (view === "walk" && r) {
        let start: [number, number] = [r.x, r.z + r.depth / 2 - 0.4];
        if (!canWalk(latest.current.scene, r, ...start)) {
          const candidates: [number, number][] = [];
          for (let z = -r.depth / 2 + 0.3; z < r.depth / 2 - 0.2; z += 0.3)
            for (let x = -r.width / 2 + 0.3; x < r.width / 2 - 0.2; x += 0.3)
              if (canWalk(latest.current.scene, r, r.x + x, r.z + z))
                candidates.push([r.x + x, r.z + z]);
          candidates.sort(
            (a, b) =>
              Math.hypot(a[0] - start[0], a[1] - start[1]) -
              Math.hypot(b[0] - start[0], b[1] - start[1]),
          );
          if (!candidates.length) {
            setStatus(
              "No clear walking space. Move furniture before entering this room.",
            );
            return;
          }
          start = candidates[0];
        }
        camera.position.set(start[0], y + 1.6, start[1]);
        yaw = Math.atan2(start[0] - r.x, start[1] - r.z);
        pitch = -0.12;
        camera.lookAt(r.x, y + 1.3, r.z);
        return;
      }
      if (latest.current.cameraOrientation === "top") {
        let topBox: T.Box3;
        if (view === "building") {
          topBox = new T.Box3();
          let hasContent = false;
          for (const root of [model, references]) {
            if (!root.children.length) continue;
            root.updateWorldMatrix(true, true);
            topBox.expandByObject(root);
            hasContent = true;
          }
          if (!hasContent)
            topBox.set(
              new T.Vector3(-5, 0, -5),
              new T.Vector3(5, 3, 5),
            );
        } else if (r) {
          topBox = new T.Box3(
            new T.Vector3(r.x - r.width / 2, y, r.z - r.depth / 2),
            new T.Vector3(
              r.x + r.width / 2,
              y + r.height,
              r.z + r.depth / 2,
            ),
          );
        } else {
          topBox = new T.Box3(
            new T.Vector3(-5, 0, -5),
            new T.Vector3(5, 3, 5),
          );
        }
        const centre = topBox.getCenter(new T.Vector3());
        const size = topBox.getSize(new T.Vector3());
        const span = Math.max(size.x / Math.max(camera.aspect, 0.1), size.z, 5);
        const distance =
          (span / Math.tan((camera.fov * Math.PI) / 360)) * 0.7;
        camera.up.set(0, 0, -1);
        controls.target.copy(centre);
        camera.position.set(centre.x, centre.y + distance, centre.z + 0.001);
        camera.lookAt(centre);
        controls.update();
        return;
      }
      camera.up.set(0, 1, 0);
      const box =
        view === "building" && model.children.length
          ? new T.Box3().setFromObject(model)
          : r
            ? new T.Box3(
                new T.Vector3(r.x - r.width / 2, y, r.z - r.depth / 2),
                new T.Vector3(
                  r.x + r.width / 2,
                  y + r.height,
                  r.z + r.depth / 2,
                ),
              )
            : new T.Box3(new T.Vector3(-5, 0, -5), new T.Vector3(5, 3, 5));
      const c = box.getCenter(new T.Vector3()),
        sz = box.getSize(new T.Vector3());
      const d =
        (Math.max(sz.y, sz.x / camera.aspect, sz.z / camera.aspect, 4) /
          Math.tan((camera.fov * Math.PI) / 360)) *
        0.8;
      controls.target.copy(c);
      camera.position
        .copy(c)
        .add(new T.Vector3(-1, 0.7, 1).normalize().multiplyScalar(d));
      controls.update();
    };
    const frameObject = (target: T.Object3D) => {
      target.updateWorldMatrix(true, true);
      const box = new T.Box3().setFromObject(target);
      if (box.isEmpty()) return;
      const centre = box.getCenter(new T.Vector3());
      const size = box.getSize(new T.Vector3());
      const distance =
        (Math.max(size.y, size.x / camera.aspect, size.z / camera.aspect, 1.5) /
          Math.tan((camera.fov * Math.PI) / 360)) *
        0.9;
      controls.target.copy(centre);
      camera.position
        .copy(centre)
        .add(new T.Vector3(-1, 0.7, 1).normalize().multiplyScalar(distance));
      controls.update();
    };
    const focusSelected = () => {
      const target = selectables.get(latest.current.selected);
      if (target) {
        frameObject(target);
        return;
      }
      const meshName = latest.current.selectedMesh;
      if (meshName) {
        let modelTarget: T.Object3D | undefined;
        model.traverse((node) => {
          if (!modelTarget && node instanceof T.Mesh && node.name === meshName)
            modelTarget = node;
        });
        if (modelTarget) {
          frameObject(modelTarget);
          return;
        }
      }
      focus();
    };
    api.current = {
      scene,
      camera,
      renderer,
      controls,
      model,
      rooms,
      references,
      keys,
      selectables,
      transform,
      hemi,
      sun,
      focus,
      focusSelected,
    };
    const resize = new ResizeObserver(() => {
      camera.aspect =
        Math.max(el.clientWidth, 1) / Math.max(el.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    resize.observe(el);
    const down = (e: KeyboardEvent) => {
      if (latest.current.view !== "walk") return;
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
        ].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        keys.add(e.key.toLowerCase());
      }
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const blur = () => keys.clear();
    let transformStart = false;
    transform.addEventListener("dragging-changed", (event) => {
      const dragging = Boolean(event.value);
      controls.enabled = !dragging && latest.current.view !== "walk";
      if (dragging) {
        transformStart = true;
        return;
      }
      if (!transformStart) return;
      transformStart = false;
      const current = latest.current;
      const target = selectables.get(current.selected);
      if (!target || !current.onTransformCommit) return;
      const selectedRoom = current.scene.rooms.find(
        (candidate) => candidate.id === current.selected,
      );
      if (selectedRoom) {
        if (current.transformMode === "translate") {
          current.onTransformCommit({
            kind: "room",
            id: selectedRoom.id,
            x: target.position.x,
            z: target.position.z,
          });
        } else if (current.transformMode === "scale") {
          current.onTransformCommit({
            kind: "room",
            id: selectedRoom.id,
            width: Math.max(0.5, selectedRoom.width * Math.abs(target.scale.x)),
            height: Math.max(1.8, selectedRoom.height * Math.abs(target.scale.y)),
            depth: Math.max(0.5, selectedRoom.depth * Math.abs(target.scale.z)),
          });
        }
        return;
      }
      const furniture = current.scene.furniture.find(
        (candidate) => candidate.id === current.selected,
      );
      if (!furniture) return;
      if (current.transformMode === "translate") {
        current.onTransformCommit({
          kind: "furniture",
          id: furniture.id,
          x: target.position.x,
          z: target.position.z,
        });
      } else if (current.transformMode === "rotate") {
        current.onTransformCommit({
          kind: "furniture",
          id: furniture.id,
          rotation: T.MathUtils.radToDeg(target.rotation.y),
        });
      }
    });
    renderer.domElement.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    renderer.domElement.addEventListener("blur", blur);
    let point:
      | { x: number; y: number; ox: number; oy: number; id: number }
      | undefined;
    const pointerDown = (e: PointerEvent) => {
      renderer.domElement.focus();
      point = {
        x: e.clientX,
        y: e.clientY,
        ox: e.clientX,
        oy: e.clientY,
        id: e.pointerId,
      };
      if (latest.current.view === "walk")
        renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!point || latest.current.view !== "walk") return;
      yaw -= (e.clientX - point.x) * 0.004;
      pitch = T.MathUtils.clamp(
        pitch - (e.clientY - point.y) * 0.004,
        -1.2,
        1.2,
      );
      point.x = e.clientX;
      point.y = e.clientY;
    };
    const click = (e: PointerEvent) => {
      if (!point) return;
      const small = Math.hypot(e.clientX - point.ox, e.clientY - point.oy) < 5;
      point = undefined;
      if (!small || latest.current.view === "walk") return;
      const rect = renderer.domElement.getBoundingClientRect(),
        ray = new T.Raycaster();
      ray.setFromCamera(
        new T.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(
        latest.current.view === "building" ? model.children : rooms.children,
        true,
      )[0];
      if (hit) {
        if (latest.current.view === "building")
          latest.current.onMesh(hit.object.name);
        else {
          let n: T.Object3D | null = hit.object;
          while (n && !n.userData.selectId) n = n.parent;
          if (n) latest.current.onSelect(n.userData.selectId);
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", click);
    let previous = performance.now(),
      frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const { r } = roomFloor();
      if (latest.current.view === "walk" && r) {
        const forward =
            Number(keys.has("w") || keys.has("arrowup")) -
            Number(keys.has("s") || keys.has("arrowdown")),
          side =
            Number(keys.has("d") || keys.has("arrowright")) -
            Number(keys.has("a") || keys.has("arrowleft"));
        const step = (dt * 1.5) / Math.max(1, Math.hypot(forward, side));
        const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * step,
          dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * step;
        if (
          canWalk(
            latest.current.scene,
            r,
            camera.position.x + dx,
            camera.position.z,
          )
        )
          camera.position.x += dx;
        if (
          canWalk(
            latest.current.scene,
            r,
            camera.position.x,
            camera.position.z + dz,
          )
        )
          camera.position.z += dz;
        camera.lookAt(
          camera.position
            .clone()
            .add(
              new T.Vector3(
                -Math.sin(yaw) * Math.cos(pitch),
                Math.sin(pitch),
                -Math.cos(yaw) * Math.cos(pitch),
              ),
            ),
        );
      } else controls.update();
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);
    focus();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      transform.detach();
      transform.dispose();
      controls.dispose();
      dispose(scene);
      renderer.dispose();
      el.replaceChildren();
      api.current = null;
    };
  }, []);
  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    let cancelled = false;
    let finishCleanup: (() => void) | undefined;
    runtime.transform.detach();
    runtime.modelSelection?.removeFromParent();
    if (runtime.modelSelection) dispose(runtime.modelSelection);
    runtime.modelSelection = undefined;
    for (const n of [...runtime.model.children]) {
      runtime.model.remove(n);
      dispose(n);
    }
    latest.current.onModelNodes?.([]);
    latest.current.onModelMaterials?.([]);
    runtime.profileExterior = undefined;
    runtime.scene.background = new T.Color(
      latest.current.scene.appearance?.background ?? "#dbe3e7",
    );
    if (!props.scene.modelId) {
      setStatus("");
      return;
    }
    setStatus("Loading model…");
    void (async () => {
      const f = await (props.resolveAsset ?? asset)(props.scene.modelId!);
      if (!f) throw Error("Model missing. Re-import a full project backup.");
      const data = await f.blob.arrayBuffer();
      let object: T.Group;
      const manager = new T.LoadingManager();
      manager.setURLModifier((url) => {
        if (url.startsWith("blob:") || url.startsWith("data:")) return url;
        throw Error(
          "External model resources are not loaded. Export a self-contained GLB with embedded textures.",
        );
      });
      if (f.name.toLowerCase().endsWith(".fbx")) {
        object = new FBXLoader(manager).parse(data, "");
        if (/^[a-f0-9]{64}$/i.test(f.hash)) {
          object.userData.sourceGeometry = {
            ...(object.userData.sourceGeometry ?? {}),
            sha256: f.hash.toLowerCase(),
          };
        }
      } else {
        const loader = new GLTFLoader(manager);
        loader.setMeshoptDecoder(MeshoptDecoder);
        object = (await loader.parseAsync(data, "")).scene;
      }
      if (cancelled) {
        dispose(object);
        return;
      }
      const referenceVisual =
        latest.current.scene.appearance?.referenceVisual ?? true;
      const modelProfile = applyModelProfileExterior(object, referenceVisual);
      runtime.profileExterior = modelProfile?.exterior;
      if (modelProfile?.exterior) {
        runtime.scene.background =
          latest.current.scene.appearance?.nightMode
            ? modelProfile.exterior.eveningSky
            : modelProfile.exterior.daylightSky;
        modelProfile.exterior.setNight(
          latest.current.scene.appearance?.nightMode ?? false,
        );
        finishCleanup = modelProfile.exterior.dispose;
      }
      const materialEnhancer =
        await loadModelProfileMaterialEnhancer(modelProfile);
      materialEnhancer?.(object, runtime.renderer, referenceVisual);
      const modelNodes: ModelNodeSummary[] = [];
      let modelNodeIndex = 0;
      object.traverse((n) => {
        if (n instanceof T.Mesh) {
          n.castShadow = true;
          n.receiveShadow = true;
          modelNodeIndex += 1;
          if (!n.name) n.name = `Mesh ${modelNodeIndex}`;
          modelNodes.push({
            key: `mesh:${modelNodeIndex}`,
            name: n.name,
            type: n.type,
          });
        }
      });
      latest.current.onModelNodes?.(modelNodes);
      runtime.model.add(object);
      const alignment = latest.current.scene.modelTransform ?? {
        x: 0,
        y: 0,
        z: 0,
        rotationY: 0,
      };
      runtime.model.position.set(alignment.x, alignment.y, alignment.z);
      runtime.model.rotation.y = T.MathUtils.degToRad(alignment.rotationY);
      runtime.model.scale.setScalar(latest.current.scene.scale);
      applyModelMaterialOverrides(runtime.model, latest.current.scene);
      latest.current.onModelMaterials?.(
        summarizeModelMaterials(runtime.model),
      );
      runtime.focus();
      setStatus(
        f.name.toLowerCase().endsWith(".fbx")
          ? "FBX loaded. Check scale and external textures before review."
          : "",
      );
    })().catch((e) => {
      if (!cancelled)
        setStatus(e instanceof Error ? e.message : "Model loading failed.");
    });
    return () => {
      cancelled = true;
      finishCleanup?.();
    };
  }, [
    props.scene.modelId,
    props.scene.appearance?.referenceVisual,
    props.resolveAsset,
  ]);
  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    let cancelled = false;
    const urls: string[] = [];
    for (const child of [...runtime.references.children]) {
      runtime.references.remove(child);
      dispose(child);
    }

    void (async () => {
      for (const layer of props.scene.referenceLayers ?? []) {
        if (
          cancelled ||
          !layer.visible ||
          !layer.metresPerPixel ||
          layer.metresPerPixel <= 0
        )
          continue;
        const source = await (props.resolveAsset ?? asset)(layer.assetId);
        if (!source || cancelled) continue;
        const isImage =
          source.type.startsWith("image/") ||
          /\.(png|jpe?g|webp|tiff?)$/i.test(source.name);
        if (!isImage) continue;

        const url = URL.createObjectURL(source.blob);
        urls.push(url);
        let texture: T.Texture;
        try {
          texture = await new Promise<T.Texture>((resolve, reject) =>
            new T.TextureLoader().load(url, resolve, undefined, reject),
          );
        } catch {
          continue;
        }
        if (cancelled) {
          texture.dispose();
          continue;
        }
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = Math.min(
          runtime.renderer.capabilities.getMaxAnisotropy(),
          8,
        );
        const image = texture.image as HTMLImageElement;
        const widthPx = image.naturalWidth || image.width || 1;
        const heightPx = image.naturalHeight || image.height || 1;
        const geometry = new T.PlaneGeometry(
          widthPx * layer.metresPerPixel,
          heightPx * layer.metresPerPixel,
        );
        const material = new T.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
          side: T.DoubleSide,
          toneMapped: false,
        });
        const plane = new T.Mesh(geometry, material);
        plane.name = `Reference · ${source.name}`;
        plane.rotation.x = -Math.PI / 2;
        plane.renderOrder = -10;
        const root = new T.Group();
        root.name = `Reference layer · ${source.name}`;
        root.position.set(layer.x, layer.y, layer.z);
        root.rotation.y = T.MathUtils.degToRad(layer.rotation);
        root.add(plane);
        runtime.references.add(root);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      for (const child of [...runtime.references.children]) {
        runtime.references.remove(child);
        dispose(child);
      }
    };
  }, [props.scene.referenceLayers, props.resolveAsset]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    const appearance = props.scene.appearance;
    runtime.renderer.toneMappingExposure = appearance?.exposure ?? 1;
    runtime.hemi.intensity = appearance?.hemisphereIntensity ?? 2.8;
    runtime.sun.intensity = appearance?.sunIntensity ?? 3.2;
    if (runtime.profileExterior) {
      const night = appearance?.nightMode ?? false;
      runtime.profileExterior.setNight(night);
      runtime.scene.background = night
        ? runtime.profileExterior.eveningSky
        : runtime.profileExterior.daylightSky;
    } else {
      runtime.scene.background = new T.Color(
        appearance?.background ?? "#dbe3e7",
      );
    }
  }, [
    props.scene.appearance?.exposure,
    props.scene.appearance?.sunIntensity,
    props.scene.appearance?.hemisphereIntensity,
    props.scene.appearance?.background,
    props.scene.appearance?.nightMode,
    props.scene.appearance?.referenceVisual,
    props.scene.modelId,
  ]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime || !runtime.model.children.length) return;
    applyModelMaterialOverrides(runtime.model, props.scene);
    props.onModelMaterials?.(summarizeModelMaterials(runtime.model));
  }, [
    props.scene.materialOverrides,
    props.scene.modelId,
    props.scene.appearance?.referenceVisual,
  ]);

  useEffect(() => {
    const r = api.current;
    if (!r) return;
    const alignment = props.scene.modelTransform ?? {
      x: 0,
      y: 0,
      z: 0,
      rotationY: 0,
    };
    r.model.position.set(alignment.x, alignment.y, alignment.z);
    r.model.rotation.y = T.MathUtils.degToRad(alignment.rotationY);
    r.model.scale.setScalar(props.scene.scale);
    r.references.visible = props.view !== "walk";
    r.transform.detach();
    r.selectables.clear();
    for (const n of [...r.rooms.children]) {
      r.rooms.remove(n);
      dispose(n);
    }
    r.model.visible = props.view === "building";
    r.rooms.visible = props.view !== "building";
    r.controls.enabled = props.view !== "walk";
    for (const room of props.scene.rooms) {
      if (props.view === "walk" && room.id !== props.roomId) continue;
      const root = new T.Group();
      root.userData.selectId = room.id;
      root.position.set(
        room.x,
        props.scene.floors.find((f) => f.id === room.floorId)?.elevation ?? 0,
        room.z,
      );
      r.rooms.add(root);
      r.selectables.set(room.id, root);
      const w = room.width,
        d = room.depth,
        h = props.view === "walk" ? room.height : 0.65;
      block(root, room.name, [w, 0.08, d], [0, -0.04, 0], room.color);
      for (const z of [-d / 2, d / 2])
        block(root, "wall", [w, 0.01 + h, 0.12], [0, h / 2, z], "#eee9df");
      for (const x of [-w / 2, w / 2])
        block(root, "wall", [0.12, h, d], [x, h / 2, 0], "#e7e0d5");
      if (room.id === props.selected) {
        const line = new T.BoxHelper(root, 0x148575);
        root.updateMatrixWorld(true);
        line.update();
        r.rooms.add(line);
      }
      for (const f of props.scene.furniture.filter(
        (f) => f.roomId === room.id,
      )) {
        const c = catalog[f.kind],
          g = new T.Group();
        g.userData.selectId = f.id;
        g.position.set(f.x, 0, f.z);
        g.rotation.y = (f.rotation * Math.PI) / 180;
        root.add(g);
        r.selectables.set(f.id, g);
        block(
          g,
          f.kind,
          [c.width, c.height, c.depth],
          [0, c.height / 2, 0],
          f.color,
        );
        if (f.kind === "sofa") {
          block(g, "backrest", [c.width, 0.5, 0.15], [0, 0.85, -0.35], f.color);
          for (const x of [-0.94, 0.94])
            block(g, "armrest", [0.22, 0.3, 0.8], [x, 0.75, 0], f.color);
        }
        if (f.kind === "bed") {
          block(g, "headboard", [1.7, 0.9, 0.1], [0, 0.45, -1], "#816958");
          for (const x of [-0.4, 0.4])
            block(g, "pillow", [0.6, 0.12, 0.4], [x, 0.62, -0.65], "#f4f0e6");
        }
        if (f.kind === "plant") {
          const leaves = new T.Mesh(
            new T.IcosahedronGeometry(0.45, 1),
            new T.MeshStandardMaterial({ color: 0x50734b }),
          );
          leaves.position.y = 1;
          g.add(leaves);
        }
        if (f.id === props.selected) {
          g.updateWorldMatrix(true, true);
          r.rooms.add(new T.BoxHelper(g, 0xd67e34));
        }
      }
    }
  }, [props.scene, props.selected, props.view, props.roomId]);
  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    runtime.transform.detach();
    const target = runtime.selectables.get(props.selected);
    if (
      !target ||
      !props.transformEnabled ||
      props.view === "walk" ||
      props.view === "building"
    )
      return;

    const isRoom = props.scene.rooms.some((room) => room.id === props.selected);
    const isFurniture = props.scene.furniture.some(
      (item) => item.id === props.selected,
    );
    const mode = props.transformMode ?? "translate";
    if ((isRoom && mode === "rotate") || (isFurniture && mode === "scale"))
      return;

    runtime.transform.setMode(mode);
    runtime.transform.showX = mode !== "rotate";
    runtime.transform.showY = mode === "scale" || mode === "rotate";
    runtime.transform.showZ = mode !== "rotate";
    runtime.transform.setTranslationSnap(props.snap ? 0.1 : null);
    runtime.transform.setRotationSnap(props.snap ? Math.PI / 12 : null);
    runtime.transform.setScaleSnap(props.snap ? 0.1 : null);
    runtime.transform.attach(target);
  }, [
    props.selected,
    props.transformMode,
    props.transformEnabled,
    props.snap,
    props.view,
    props.scene,
    props.roomId,
  ]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    runtime.modelSelection?.removeFromParent();
    if (runtime.modelSelection) dispose(runtime.modelSelection);
    runtime.modelSelection = undefined;
    if (!props.selectedMesh || props.view !== "building") return;
    let selectedObject: T.Object3D | undefined;
    runtime.model.traverse((node) => {
      if (!selectedObject && node instanceof T.Mesh && node.name === props.selectedMesh)
        selectedObject = node;
    });
    if (!selectedObject) return;
    const helper = new T.BoxHelper(selectedObject, 0x8d84ff);
    runtime.scene.add(helper);
    runtime.modelSelection = helper;
  }, [
    props.selectedMesh,
    props.view,
    props.scene.modelId,
    props.scene.appearance?.referenceVisual,
  ]);

  useEffect(() => {
    if (props.focusRequest === undefined) return;
    api.current?.focusSelected();
  }, [props.focusRequest]);

  useEffect(() => {
    api.current?.focus();
  }, [
    props.roomId,
    props.view,
    props.cameraOrientation,
    props.scene.modelTransform?.x,
    props.scene.modelTransform?.y,
    props.scene.modelTransform?.z,
    props.scene.modelTransform?.rotationY,
  ]);
  return (
    <div className="canvas-wrap">
      <div className="studio-canvas" ref={host} />
      {status && (
        <div className="canvas-status" role="status">
          {status}
        </div>
      )}
      <button className="reset-camera" onClick={() => api.current?.focus()}>
        Reset view
      </button>
      {props.view === "walk" && (
        <div className="walk-pad">
          <span>Drag to look · WASD to walk · room-bounded</span>
          {[
            ["w", "↑"],
            ["a", "←"],
            ["s", "↓"],
            ["d", "→"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-label={`Walk ${label}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                api.current?.keys.add(key);
              }}
              onPointerUp={() => api.current?.keys.delete(key)}
              onPointerCancel={() => api.current?.keys.delete(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

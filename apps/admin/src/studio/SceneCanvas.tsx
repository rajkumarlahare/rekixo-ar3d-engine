import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { disposeObjectResources } from "./threeResources";
import {
  applyModelMaterialOverrides,
  applyModelNodeVisibility,
  summarizeModelMaterials,
  type ModelMaterialSummary,
} from "./sceneCanvasModel";
import { block, roomSurface } from "./sceneCanvasRooms";
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
  reviewedDoorConnections,
  resolveReviewedDoorWalkStep,
  roomBoundaryPoints,
  type Asset,
  type Room,
  type RoomPoint,
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
    }
  | {
      kind: "model";
      x?: number;
      y?: number;
      z?: number;
      rotationY?: number;
    };
export interface ModelNodeSummary {
  key: string;
  name: string;
  type: string;
  occurrence: number;
  centreY: number;
}
export type { ModelMaterialSummary } from "./sceneCanvasModel";
export interface RoomDrawResult {
  x: number;
  z: number;
  width: number;
  depth: number;
}
interface Props {
  resolveAsset?: (id: string) => Promise<Asset | undefined>;
  scene: SceneData;
  roomId: string;
  view: View;
  selected: string;
  onSelect: (id: string) => void;
  onMesh: (name: string) => void;
  onModelNodeSelect?: (node: ModelNodeSummary) => void;
  selectedMesh?: string;
  selectedMeshKey?: string;
  transformMode?: TransformMode;
  transformEnabled?: boolean;
  snap?: boolean;
  focusRequest?: number;
  onTransformCommit?: (change: TransformCommit) => void;
  onModelNodes?: (nodes: ModelNodeSummary[]) => void;
  onModelMaterials?: (materials: ModelMaterialSummary[]) => void;
  cameraOrientation?: "perspective" | "top";
  showReferenceLayers?: boolean;
  modelTransformEnabled?: boolean;
  alignmentMode?: boolean;
  roomMapEnabled?: boolean;
  roomDraw?: {
    enabled: boolean;
    floorId: string;
    snap: boolean;
  };
  roomStamp?: {
    enabled: boolean;
    floorId: string;
    snap: boolean;
    width: number;
    depth: number;
  };
  roomPolygonDraw?: {
    enabled: boolean;
    floorId: string;
    snap: boolean;
  };
  roomPolygonEdit?: {
    enabled: boolean;
    roomId: string;
    snap: boolean;
  };
  onRoomDraw?: (result: RoomDrawResult) => void;
  onRoomPolygonDraw?: (points: RoomPoint[]) => void;
  onRoomPolygonChange?: (roomId: string, points: RoomPoint[]) => void;
  onWalkRoomChange?: (roomId: string, openingId: string) => void;
  isolateFloorId?: string;
  sectionCut?: {
    enabled: boolean;
    axis: "x" | "y" | "z";
    offset: number;
    flip: boolean;
  };
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
    walkRoomId: string;
    selectables: Map<string, T.Object3D>;
    transform: TransformControls;
    hemi: T.HemisphereLight;
    sun: T.DirectionalLight;
    profileExterior?: ModelProfileRuntime["exterior"];
    modelSelection?: T.BoxHelper;
    roomDraft: T.Mesh;
    polygonDraft: T.Group;
    polygonEdit: T.Group;
    clearPolygonDraft: () => void;
    renderPolygonEdit: (room?: Room, points?: RoomPoint[]) => void;
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
    renderer.localClippingEnabled = true;
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
    controls.enableRotate = !latest.current.alignmentMode;
    controls.enablePan = !latest.current.alignmentMode;
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
    const roomDraft = new T.Mesh(
      new T.BoxGeometry(1, 0.06, 1),
      new T.MeshBasicMaterial({
        color: 0x8d84ff,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    roomDraft.visible = false;
    roomDraft.renderOrder = 30;
    const polygonDraft = new T.Group();
    polygonDraft.name = "Room polygon draft";
    polygonDraft.renderOrder = 31;
    const polygonEdit = new T.Group();
    polygonEdit.name = "Room polygon edit handles";
    polygonEdit.renderOrder = 32;
    scene.add(references, model, rooms, roomDraft, polygonDraft, polygonEdit);
    const keys = new Set<string>();
    const selectables = new Map<string, T.Object3D>();
    const transform = new TransformControls(camera, renderer.domElement);
    scene.add(transform.getHelper());
    const roomFloor = () => {
      const { scene: s, roomId, view } = latest.current;
      const activeRoomId =
        view === "walk" ? api.current?.walkRoomId || roomId : roomId;
      const r = s.rooms.find((candidate) => candidate.id === activeRoomId);
      return {
        r,
        y: s.floors.find((f) => f.id === r?.floorId)?.elevation ?? 0,
      };
    };
    const polygonDraftPoints: T.Vector3[] = [];
    const clearPolygonDraft = () => {
      polygonDraftPoints.length = 0;
      for (const child of [...polygonDraft.children]) {
        polygonDraft.remove(child);
        disposeObjectResources(child);
      }
    };
    const renderPolygonEdit = (room?: Room, points?: RoomPoint[]) => {
      for (const child of [...polygonEdit.children]) {
        polygonEdit.remove(child);
        disposeObjectResources(child);
      }
      if (!room?.polygon?.length) return;
      const floorY =
        latest.current.scene.floors.find(
          (floor) => floor.id === room.floorId,
        )?.elevation ?? 0;
      const source = points ?? room.polygon;
      const vectors = source.map(
        ([x, z]) => new T.Vector3(x, floorY + 0.11, z),
      );
      if (vectors.length >= 3) {
        const loop = new T.LineLoop(
          new T.BufferGeometry().setFromPoints(vectors),
          new T.LineBasicMaterial({
            color: 0xb9b2ff,
            transparent: true,
            opacity: 0.98,
          }),
        );
        polygonEdit.add(loop);
      }
      vectors.forEach((point, index) => {
        const marker = new T.Mesh(
          new T.SphereGeometry(0.12, 14, 10),
          new T.MeshBasicMaterial({ color: 0x8d84ff }),
        );
        marker.position.copy(point);
        marker.userData.roomVertexIndex = index;
        marker.userData.roomId = room.id;
        polygonEdit.add(marker);
      });
    };
    const redrawPolygonDraft = (hover?: T.Vector3) => {
      for (const child of [...polygonDraft.children]) {
        polygonDraft.remove(child);
        disposeObjectResources(child);
      }
      const points = hover
        ? [...polygonDraftPoints, hover]
        : [...polygonDraftPoints];
      if (points.length >= 2) {
        const geometry = new T.BufferGeometry().setFromPoints(points);
        const line = new T.Line(
          geometry,
          new T.LineBasicMaterial({
            color: 0x8d84ff,
            transparent: true,
            opacity: 0.95,
          }),
        );
        polygonDraft.add(line);
      }
      for (const point of polygonDraftPoints) {
        const marker = new T.Mesh(
          new T.SphereGeometry(0.09, 12, 8),
          new T.MeshBasicMaterial({ color: 0xb9b2ff }),
        );
        marker.position.copy(point);
        polygonDraft.add(marker);
      }
    };
    const finishPolygonDraft = () => {
      if (polygonDraftPoints.length < 3) {
        setStatus("Add at least 3 corners before finishing the room.");
        return;
      }
      const points = polygonDraftPoints.map(
        (point) => [Number(point.x.toFixed(3)), Number(point.z.toFixed(3))] as RoomPoint,
      );
      latest.current.onRoomPolygonDraw?.(points);
      clearPolygonDraft();
      setStatus("");
    };
    let yaw = 0,
      pitch = 0;
    const focus = () => {
      const { r, y } = roomFloor(),
        { view } = latest.current;
      keys.clear();
      if (view === "walk" && r) {
        if (
          Math.abs(camera.position.y - (y + 1.6)) <= 0.45 &&
          canWalk(
            latest.current.scene,
            r,
            camera.position.x,
            camera.position.z,
          )
        ) {
          const connections = reviewedDoorConnections(
            latest.current.scene,
            r.id,
          ).length;
          setStatus(
            connections
              ? `${r.name} · ${connections} reviewed door connection${connections === 1 ? "" : "s"}`
              : `${r.name} · no reviewed room-to-room doors`,
          );
          return;
        }
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
        let topBox = new T.Box3(
          new T.Vector3(-5, 0, -5),
          new T.Vector3(5, 3, 5),
        );
        if (view === "building") {
          const contentBox = new T.Box3();
          let hasContent = false;
          for (const root of [model, references]) {
            if (!root.children.length) continue;
            root.updateWorldMatrix(true, true);
            contentBox.expandByObject(root);
            hasContent = true;
          }
          if (hasContent) topBox = contentBox;
        }
        if (view !== "building" && r) {
          const boundary = roomBoundaryPoints(r);
          const minX = Math.min(...boundary.map((point) => point[0]));
          const maxX = Math.max(...boundary.map((point) => point[0]));
          const minZ = Math.min(...boundary.map((point) => point[1]));
          const maxZ = Math.max(...boundary.map((point) => point[1]));
          topBox = new T.Box3(
            new T.Vector3(minX, y, minZ),
            new T.Vector3(maxX, y + r.height, maxZ),
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
            ? (() => {
                const boundary = roomBoundaryPoints(r);
                const minX = Math.min(...boundary.map((point) => point[0]));
                const maxX = Math.max(...boundary.map((point) => point[0]));
                const minZ = Math.min(...boundary.map((point) => point[1]));
                const maxZ = Math.max(...boundary.map((point) => point[1]));
                return new T.Box3(
                  new T.Vector3(minX, y, minZ),
                  new T.Vector3(maxX, y + r.height, maxZ),
                );
              })()
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
      const meshKey = latest.current.selectedMeshKey;
      const meshName = latest.current.selectedMesh;
      if (meshKey || meshName) {
        let modelTarget: T.Object3D | undefined;
        model.traverse((node) => {
          if (modelTarget || !(node instanceof T.Mesh)) return;
          if (
            (meshKey && node.userData.studioNodeKey === meshKey) ||
            (!meshKey && meshName && node.name === meshName)
          )
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
      walkRoomId: props.roomId,
      selectables,
      transform,
      hemi,
      sun,
      roomDraft,
      polygonDraft,
      polygonEdit,
      clearPolygonDraft,
      renderPolygonEdit,
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
      if (latest.current.roomPolygonDraw?.enabled) {
        if (e.key === "Enter") {
          e.preventDefault();
          finishPolygonDraft();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          clearPolygonDraft();
          setStatus("");
        }
        return;
      }
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
      controls.enableRotate = !latest.current.alignmentMode;
      controls.enablePan = !latest.current.alignmentMode;
      if (dragging) {
        transformStart = true;
        return;
      }
      if (!transformStart) return;
      transformStart = false;
      const current = latest.current;
      const target =
        transform.object ?? selectables.get(current.selected);
      if (!target || !current.onTransformCommit) return;
      if (target === model && current.modelTransformEnabled) {
        if (current.transformMode === "translate") {
          current.onTransformCommit({
            kind: "model",
            x: model.position.x,
            y: model.position.y,
            z: model.position.z,
          });
        } else if (current.transformMode === "rotate") {
          current.onTransformCommit({
            kind: "model",
            rotationY: T.MathUtils.radToDeg(model.rotation.y),
          });
        }
        return;
      }
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
    let roomDrawStart: T.Vector3 | undefined;
    let roomStampCenter: T.Vector3 | undefined;
    let vertexDrag:
      | {
          roomId: string;
          index: number;
          points: RoomPoint[];
          floorId: string;
        }
      | undefined;

    const snapRoomPoint = (
      point: T.Vector3,
      floorId: string,
      enabled: boolean,
      excludeRoomId?: string,
    ) => {
      if (!enabled) return point;
      const grid = new T.Vector3(
        Math.round(point.x * 10) / 10,
        point.y,
        Math.round(point.z * 10) / 10,
      );
      let best = grid;
      let bestDistance = Math.hypot(grid.x - point.x, grid.z - point.z);
      for (const room of latest.current.scene.rooms) {
        if (room.floorId !== floorId || room.id === excludeRoomId) continue;
        const boundary = roomBoundaryPoints(room);
        for (let index = 0; index < boundary.length; index += 1) {
          const [vx, vz] = boundary[index];
          const vertexDistance = Math.hypot(vx - point.x, vz - point.z);
          if (vertexDistance <= 0.24 && vertexDistance < bestDistance) {
            best = new T.Vector3(vx, point.y, vz);
            bestDistance = vertexDistance;
          }
          const [ax, az] = boundary[index];
          const [bx, bz] = boundary[(index + 1) % boundary.length];
          const dx = bx - ax;
          const dz = bz - az;
          const lengthSquared = dx * dx + dz * dz;
          const t =
            lengthSquared > 0
              ? T.MathUtils.clamp(
                  ((point.x - ax) * dx + (point.z - az) * dz) /
                    lengthSquared,
                  0,
                  1,
                )
              : 0;
          const px = ax + t * dx;
          const pz = az + t * dz;
          const edgeDistance = Math.hypot(px - point.x, pz - point.z);
          if (edgeDistance <= 0.18 && edgeDistance < bestDistance) {
            best = new T.Vector3(px, point.y, pz);
            bestDistance = edgeDistance;
          }
        }
      }
      return best;
    };

    const roomPlanePoint = (
      event: PointerEvent,
      excludeRoomId?: string,
    ) => {
      const rectangle = latest.current.roomDraw;
      const stamp = latest.current.roomStamp;
      const polygon = latest.current.roomPolygonDraw;
      const edit = latest.current.roomPolygonEdit;
      const config = rectangle?.enabled
        ? rectangle
        : stamp?.enabled
          ? stamp
          : polygon?.enabled
            ? polygon
            : edit?.enabled
            ? {
                enabled: true,
                floorId:
                  latest.current.scene.rooms.find(
                    (room) => room.id === edit.roomId,
                  )?.floorId ?? "",
                snap: edit.snap,
              }
            : undefined;
      if (!config?.enabled || !config.floorId) return undefined;
      const floor = latest.current.scene.floors.find(
        (entry) => entry.id === config.floorId,
      );
      if (!floor) return undefined;
      const rect = renderer.domElement.getBoundingClientRect();
      const raycaster = new T.Raycaster();
      raycaster.setFromCamera(
        new T.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const target = new T.Vector3();
      const plane = new T.Plane(new T.Vector3(0, 1, 0), -floor.elevation);
      if (!raycaster.ray.intersectPlane(plane, target)) return undefined;
      target.y = floor.elevation + 0.04;
      return snapRoomPoint(target, floor.id, config.snap, excludeRoomId);
    };

    const updateRoomDraft = (start: T.Vector3, end: T.Vector3) => {
      const width = Math.max(0.01, Math.abs(end.x - start.x));
      const depth = Math.max(0.01, Math.abs(end.z - start.z));
      roomDraft.position.set(
        (start.x + end.x) / 2,
        start.y,
        (start.z + end.z) / 2,
      );
      roomDraft.scale.set(width, 1, depth);
      roomDraft.visible = true;
    };

    const pointerDown = (e: PointerEvent) => {
      renderer.domElement.focus();
      if (
        e.button === 0 &&
        latest.current.roomPolygonEdit?.enabled &&
        latest.current.view === "building"
      ) {
        const rect = renderer.domElement.getBoundingClientRect();
        const raycaster = new T.Raycaster();
        raycaster.setFromCamera(
          new T.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hit = raycaster.intersectObjects(polygonEdit.children, true)[0];
        const index = hit?.object.userData.roomVertexIndex;
        const roomId = hit?.object.userData.roomId;
        const targetRoom =
          typeof roomId === "string"
            ? latest.current.scene.rooms.find((room) => room.id === roomId)
            : undefined;
        if (
          targetRoom?.polygon?.length &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < targetRoom.polygon.length
        ) {
          vertexDrag = {
            roomId: targetRoom.id,
            index,
            points: targetRoom.polygon.map(
              ([x, z]) => [x, z] as RoomPoint,
            ),
            floorId: targetRoom.floorId,
          };
          controls.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
          point = {
            x: e.clientX,
            y: e.clientY,
            ox: e.clientX,
            oy: e.clientY,
            id: e.pointerId,
          };
          return;
        }
      }
      if (
        e.button === 0 &&
        latest.current.roomPolygonDraw?.enabled &&
        latest.current.view === "building"
      ) {
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
        point = {
          x: e.clientX,
          y: e.clientY,
          ox: e.clientX,
          oy: e.clientY,
          id: e.pointerId,
        };
        return;
      }
      if (
        e.button === 0 &&
        latest.current.roomStamp?.enabled &&
        latest.current.view === "building"
      ) {
        const center = roomPlanePoint(e);
        const stamp = latest.current.roomStamp;
        if (center && stamp) {
          roomStampCenter = center;
          roomDraft.position.set(center.x, center.y, center.z);
          roomDraft.scale.set(stamp.width, 1, stamp.depth);
          roomDraft.visible = true;
          controls.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
          point = {
            x: e.clientX,
            y: e.clientY,
            ox: e.clientX,
            oy: e.clientY,
            id: e.pointerId,
          };
          return;
        }
      }
      if (
        e.button === 0 &&
        latest.current.roomDraw?.enabled &&
        latest.current.view === "building"
      ) {
        const start = roomPlanePoint(e);
        if (start) {
          roomDrawStart = start;
          roomDraft.visible = false;
          controls.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
          point = {
            x: e.clientX,
            y: e.clientY,
            ox: e.clientX,
            oy: e.clientY,
            id: e.pointerId,
          };
          return;
        }
      }
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
      if (vertexDrag) {
        const target = roomPlanePoint(e, vertexDrag.roomId);
        if (target) {
          vertexDrag.points[vertexDrag.index] = [target.x, target.z];
          const room = latest.current.scene.rooms.find(
            (entry) => entry.id === vertexDrag?.roomId,
          );
          api.current?.renderPolygonEdit(room, vertexDrag.points);
        }
        return;
      }
      if (latest.current.roomPolygonDraw?.enabled && point) {
        const hover = roomPlanePoint(e);
        if (hover) redrawPolygonDraft(hover);
        return;
      }
      if (roomStampCenter && latest.current.roomStamp?.enabled) {
        const center = roomPlanePoint(e);
        const stamp = latest.current.roomStamp;
        if (center && stamp) {
          roomStampCenter = center;
          roomDraft.position.set(center.x, center.y, center.z);
          roomDraft.scale.set(stamp.width, 1, stamp.depth);
          roomDraft.visible = true;
        }
        return;
      }
      if (roomDrawStart && latest.current.roomDraw?.enabled) {
        const end = roomPlanePoint(e);
        if (end) updateRoomDraft(roomDrawStart, end);
        return;
      }
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
      if (vertexDrag) {
        const current = vertexDrag;
        const target = roomPlanePoint(e, current.roomId);
        if (target)
          current.points[current.index] = [target.x, target.z];
        vertexDrag = undefined;
        point = undefined;
        controls.enabled = latest.current.view !== "walk";
        try {
          renderer.domElement.releasePointerCapture(e.pointerId);
        } catch {}
        latest.current.onRoomPolygonChange?.(
          current.roomId,
          current.points.map(([x, z]) => [x, z] as RoomPoint),
        );
        return;
      }
      if (latest.current.roomPolygonDraw?.enabled) {
        if (!point) return;
        const small = Math.hypot(e.clientX - point.ox, e.clientY - point.oy) < 5;
        point = undefined;
        controls.enabled = latest.current.view !== "walk";
        try {
          renderer.domElement.releasePointerCapture(e.pointerId);
        } catch {}
        if (!small) return;
        const corner = roomPlanePoint(e);
        if (!corner) return;
        const first = polygonDraftPoints[0];
        if (
          first &&
          polygonDraftPoints.length >= 3 &&
          Math.hypot(first.x - corner.x, first.z - corner.z) <= 0.28
        ) {
          finishPolygonDraft();
          return;
        }
        polygonDraftPoints.push(corner.clone());
        redrawPolygonDraft();
        setStatus(
          polygonDraftPoints.length < 3
            ? `${polygonDraftPoints.length} corner${polygonDraftPoints.length === 1 ? "" : "s"} · add at least 3`
            : `${polygonDraftPoints.length} corners · click first corner or press Enter to finish`,
        );
        return;
      }
      if (roomStampCenter) {
        const saved = roomStampCenter;
        const center = roomPlanePoint(e) ?? saved;
        const stamp = latest.current.roomStamp;
        roomStampCenter = undefined;
        roomDraft.visible = false;
        controls.enabled = latest.current.view !== "walk";
        point = undefined;
        try {
          renderer.domElement.releasePointerCapture(e.pointerId);
        } catch {}
        if (stamp) {
          setStatus("");
          latest.current.onRoomDraw?.({
            x: Number(center.x.toFixed(3)),
            z: Number(center.z.toFixed(3)),
            width: Number(stamp.width.toFixed(3)),
            depth: Number(stamp.depth.toFixed(3)),
          });
        }
        return;
      }
      if (roomDrawStart) {
        const start = roomDrawStart;
        const end = roomPlanePoint(e);
        roomDrawStart = undefined;
        roomDraft.visible = false;
        controls.enabled = latest.current.view !== "walk";
        point = undefined;
        try {
          renderer.domElement.releasePointerCapture(e.pointerId);
        } catch {}
        if (end) {
          const width = Math.abs(end.x - start.x);
          const depth = Math.abs(end.z - start.z);
          if (width >= 0.5 && depth >= 0.5) {
            setStatus("");
            latest.current.onRoomDraw?.({
              x: Number(((start.x + end.x) / 2).toFixed(3)),
              z: Number(((start.z + end.z) / 2).toFixed(3)),
              width: Number(width.toFixed(3)),
              depth: Number(depth.toFixed(3)),
            });
            return;
          }
          setStatus("Drag a room at least 0.5 m × 0.5 m.");
        }
        return;
      }
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
      const roomHit =
        latest.current.view === "building" && latest.current.roomMapEnabled
          ? ray.intersectObjects(rooms.children, true)[0]
          : undefined;
      if (roomHit) {
        let selectedRoomNode: T.Object3D | null = roomHit.object;
        while (selectedRoomNode && !selectedRoomNode.userData.selectId)
          selectedRoomNode = selectedRoomNode.parent;
        if (selectedRoomNode?.userData.selectId) {
          latest.current.onSelect(selectedRoomNode.userData.selectId);
          return;
        }
      }
      const hit = ray.intersectObjects(
        latest.current.view === "building" ? model.children : rooms.children,
        true,
      )[0];
      if (hit) {
        if (latest.current.view === "building") {
          let n: T.Object3D | null = hit.object;
          while (n && !n.userData.studioNodeKey && n !== model) n = n.parent;
          if (n?.userData.studioNodeKey) {
            const summary: ModelNodeSummary = {
              key: String(n.userData.studioNodeKey),
              name: String(n.userData.studioNodeName ?? n.name),
              type: n.type,
              occurrence: Number(n.userData.studioNodeOccurrence ?? 1),
              centreY: Number(n.userData.studioNodeCentreY ?? 0),
            };
            latest.current.onMesh(summary.name);
            latest.current.onModelNodeSelect?.(summary);
          }
        }
        if (latest.current.view !== "building") {
          let n: T.Object3D | null = hit.object;
          while (n && !n.userData.selectId) n = n.parent;
          if (n) latest.current.onSelect(n.userData.selectId);
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", click);
    renderer.domElement.addEventListener("pointercancel", click);
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
        if (Math.abs(dx) > 0.000001 || Math.abs(dz) > 0.000001) {
          const sceneData = latest.current.scene;
          const fromX = camera.position.x;
          const fromZ = camera.position.z;
          let resolved = resolveReviewedDoorWalkStep(
            sceneData,
            r,
            fromX,
            fromZ,
            fromX + dx,
            fromZ + dz,
          );
          if (
            resolved.roomId === r.id &&
            resolved.x === fromX &&
            resolved.z === fromZ
          ) {
            const slideX = resolveReviewedDoorWalkStep(
              sceneData,
              r,
              fromX,
              fromZ,
              fromX + dx,
              fromZ,
            );
            if (
              slideX.roomId !== r.id ||
              slideX.x !== fromX ||
              slideX.z !== fromZ
            )
              resolved = slideX;
            else
              resolved = resolveReviewedDoorWalkStep(
                sceneData,
                r,
                fromX,
                fromZ,
                fromX,
                fromZ + dz,
              );
          }
          camera.position.x = resolved.x;
          camera.position.z = resolved.z;
          if (resolved.roomId !== r.id && resolved.openingId) {
            api.current!.walkRoomId = resolved.roomId;
            const destination = sceneData.rooms.find(
              (candidate) => candidate.id === resolved.roomId,
            );
            const connections = reviewedDoorConnections(
              sceneData,
              resolved.roomId,
            ).length;
            setStatus(
              `Entered ${destination?.name ?? "connected room"} through reviewed door · ${connections} connection${connections === 1 ? "" : "s"}`,
            );
            latest.current.onWalkRoomChange?.(
              resolved.roomId,
              resolved.openingId,
            );
          }
        }
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
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", click);
      renderer.domElement.removeEventListener("pointercancel", click);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      transform.detach();
      transform.dispose();
      controls.dispose();
      disposeObjectResources(scene);
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
    if (runtime.modelSelection) disposeObjectResources(runtime.modelSelection);
    runtime.modelSelection = undefined;
    for (const n of [...runtime.model.children]) {
      runtime.model.remove(n);
      disposeObjectResources(n);
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
      const modelNodes: ModelNodeSummary[] = [];
      const nodeOccurrences = new Map<string, number>();
      let modelNodeIndex = 0;
      object.updateWorldMatrix(true, true);
      object.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        modelNodeIndex += 1;
        if (!node.name) node.name = `Mesh ${modelNodeIndex}`;
        const occurrence = (nodeOccurrences.get(node.name) ?? 0) + 1;
        nodeOccurrences.set(node.name, occurrence);
        const key = `mesh:${modelNodeIndex}`;
        const bounds = new T.Box3().setFromObject(node);
        const centreY = bounds.isEmpty()
          ? 0
          : bounds.getCenter(new T.Vector3()).y;
        node.userData.studioNodeKey = key;
        node.userData.studioNodeName = node.name;
        node.userData.studioNodeOccurrence = occurrence;
        node.userData.studioNodeCentreY = centreY;
        modelNodes.push({
          key,
          name: node.name,
          type: node.type,
          occurrence,
          centreY,
        });
      });
      latest.current.onModelNodes?.(modelNodes);
      if (cancelled) {
        disposeObjectResources(object);
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
      object.traverse((n) => {
        if (n instanceof T.Mesh) {
          n.castShadow = true;
          n.receiveShadow = true;
        }
      });
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
      applyModelNodeVisibility(
        runtime.model,
        latest.current.scene,
        latest.current.isolateFloorId,
      );
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
      disposeObjectResources(child);
    }
    if (!props.showReferenceLayers) return;

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
          color: props.alignmentMode ? 0xbfd7ee : 0xffffff,
          transparent: true,
          opacity: props.alignmentMode
            ? Math.min(layer.opacity, 0.34)
            : layer.opacity,
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
        disposeObjectResources(child);
      }
    };
  }, [
    props.scene.referenceLayers,
    props.resolveAsset,
    props.showReferenceLayers,
    props.alignmentMode,
  ]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    applyModelNodeVisibility(
      runtime.model,
      props.scene,
      props.isolateFloorId,
    );
  }, [
    props.scene.modelNodeTags,
    props.isolateFloorId,
    props.scene.modelId,
    props.scene.appearance?.referenceVisual,
  ]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    const planes: T.Plane[] = [];
    if (props.isolateFloorId) {
      const floors = [...props.scene.floors].sort(
        (left, right) => left.elevation - right.elevation,
      );
      const index = floors.findIndex(
        (floor) => floor.id === props.isolateFloorId,
      );
      const floor = floors[index];
      if (floor) {
        const roomHeight = Math.max(
          3,
          ...props.scene.rooms
            .filter((room) => room.floorId === floor.id)
            .map((room) => room.height),
        );
        const next = floors[index + 1];
        const lower = floor.elevation - 0.06;
        const upper = (next?.elevation ?? floor.elevation + roomHeight) - 0.04;
        planes.push(
          new T.Plane(new T.Vector3(0, 1, 0), -lower),
          new T.Plane(new T.Vector3(0, -1, 0), upper),
        );
      }
    }
    if (props.sectionCut?.enabled) {
      const normal =
        props.sectionCut.axis === "x"
          ? new T.Vector3(1, 0, 0)
          : props.sectionCut.axis === "y"
            ? new T.Vector3(0, 1, 0)
            : new T.Vector3(0, 0, 1);
      if (props.sectionCut.flip) normal.negate();
      const sign = props.sectionCut.flip ? -1 : 1;
      planes.push(
        new T.Plane(normal, -props.sectionCut.offset * sign),
      );
    }
    runtime.renderer.clippingPlanes = planes;
  }, [
    props.isolateFloorId,
    props.sectionCut?.enabled,
    props.sectionCut?.axis,
    props.sectionCut?.offset,
    props.sectionCut?.flip,
    props.scene.floors,
    props.scene.rooms,
  ]);

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
      disposeObjectResources(n);
    }
    r.model.visible = props.view === "building";
    r.rooms.visible = props.view !== "building" || Boolean(props.roomMapEnabled);
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
      root.visible =
        !props.isolateFloorId || room.floorId === props.isolateFloorId;
      r.rooms.add(root);
      r.selectables.set(room.id, root);
      const h = props.view === "walk" ? room.height : 0.65;
      roomSurface(
        root,
        room,
        h,
        Boolean(props.roomMapEnabled && props.view === "building"),
        room.id === props.selected,
      );
      if (room.id === props.selected) {
        const line = new T.BoxHelper(root, 0x148575);
        root.updateMatrixWorld(true);
        line.update();
        r.rooms.add(line);
      }
      if (props.roomMapEnabled && props.view === "building") continue;
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

    for (const opening of props.scene.openings ?? []) {
      if (!opening.reviewed) continue;
      if (
        props.isolateFloorId &&
        opening.floorId !== props.isolateFloorId
      )
        continue;
      if (
        props.view === "walk" &&
        !opening.roomIds.includes(props.roomId)
      )
        continue;
      const material = new T.MeshStandardMaterial({
        color: opening.kind === "door" ? 0xd0a45d : 0x72b9d6,
        transparent: true,
        opacity:
          props.roomMapEnabled && props.view === "building" ? 0.78 : 0.58,
        depthWrite: false,
        roughness: 0.45,
        metalness: opening.kind === "window" ? 0.08 : 0,
      });
      const marker = new T.Mesh(
        new T.BoxGeometry(
          Math.max(0.08, opening.width),
          Math.max(0.08, opening.height),
          0.09,
        ),
        material,
      );
      marker.name = `Opening · ${opening.kind}`;
      marker.position.set(opening.x, opening.y, opening.z);
      marker.rotation.y = T.MathUtils.degToRad(opening.rotationY);
      marker.renderOrder = 24;
      marker.userData.openingId = opening.id;
      r.rooms.add(marker);
    }
  }, [
    props.scene,
    props.selected,
    props.view,
    props.roomId,
    props.isolateFloorId,
    props.roomMapEnabled,
  ]);
  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    runtime.transform.detach();
    const mode = props.transformMode ?? "translate";
    runtime.transform.setTranslationSnap(props.snap ? 0.1 : null);
    runtime.transform.setRotationSnap(props.snap ? Math.PI / 12 : null);
    runtime.transform.setScaleSnap(props.snap ? 0.1 : null);

    if (
      props.view === "building" &&
      props.modelTransformEnabled &&
      !props.roomMapEnabled &&
      props.transformEnabled &&
      mode !== "scale"
    ) {
      runtime.transform.setMode(mode);
      runtime.transform.showX = mode === "translate";
      runtime.transform.showY = mode === "rotate" && Boolean(props.alignmentMode);
      runtime.transform.showZ = mode === "translate";
      runtime.transform.attach(runtime.model);
      return;
    }

    const target = runtime.selectables.get(props.selected);
    if (
      !target ||
      !props.transformEnabled ||
      props.view === "walk" ||
      (props.view === "building" && !props.roomMapEnabled)
    )
      return;

    const isRoom = props.scene.rooms.some((room) => room.id === props.selected);
    const isFurniture = props.scene.furniture.some(
      (item) => item.id === props.selected,
    );
    if ((isRoom && mode === "rotate") || (isFurniture && mode === "scale"))
      return;

    runtime.transform.setMode(mode);
    runtime.transform.showX = mode !== "rotate";
    runtime.transform.showY = mode === "scale" || mode === "rotate";
    runtime.transform.showZ = mode !== "rotate";
    runtime.transform.attach(target);
  }, [
    props.selected,
    props.transformMode,
    props.transformEnabled,
    props.modelTransformEnabled,
    props.alignmentMode,
    props.roomMapEnabled,
    props.snap,
    props.view,
    props.scene,
    props.roomId,
  ]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    runtime.modelSelection?.removeFromParent();
    if (runtime.modelSelection) disposeObjectResources(runtime.modelSelection);
    runtime.modelSelection = undefined;
    if (
      (!props.selectedMesh && !props.selectedMeshKey) ||
      props.view !== "building"
    )
      return;
    let selectedObject: T.Object3D | undefined;
    runtime.model.traverse((node) => {
      if (selectedObject || !(node instanceof T.Mesh)) return;
      if (
        (props.selectedMeshKey &&
          node.userData.studioNodeKey === props.selectedMeshKey) ||
        (!props.selectedMeshKey &&
          props.selectedMesh &&
          node.name === props.selectedMesh)
      )
        selectedObject = node;
    });
    if (!selectedObject) return;
    const helper = new T.BoxHelper(selectedObject, 0x8d84ff);
    runtime.scene.add(helper);
    runtime.modelSelection = helper;
  }, [
    props.selectedMesh,
    props.selectedMeshKey,
    props.view,
    props.scene.modelId,
    props.scene.appearance?.referenceVisual,
  ]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    runtime.walkRoomId = props.roomId;
  }, [props.roomId, props.view]);

  useEffect(() => {
    if (props.roomPolygonDraw?.enabled) return;
    api.current?.clearPolygonDraft();
  }, [props.roomPolygonDraw?.enabled, props.roomPolygonDraw?.floorId]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime) return;
    if (!props.roomPolygonEdit?.enabled) {
      runtime.renderPolygonEdit(undefined);
      return;
    }
    const room = props.scene.rooms.find(
      (entry) => entry.id === props.roomPolygonEdit?.roomId,
    );
    runtime.renderPolygonEdit(room);
  }, [
    props.roomPolygonEdit?.enabled,
    props.roomPolygonEdit?.roomId,
    props.scene.rooms,
  ]);

  useEffect(() => {
    if (props.focusRequest === undefined) return;
    api.current?.focusSelected();
  }, [props.focusRequest]);

  useEffect(() => {
    if (props.alignmentMode) return;
    api.current?.focus();
  }, [
    props.roomId,
    props.view,
    props.cameraOrientation,
    props.scene.modelTransform?.x,
    props.scene.modelTransform?.y,
    props.scene.modelTransform?.z,
    props.scene.modelTransform?.rotationY,
    props.alignmentMode,
  ]);

  useEffect(() => {
    const runtime = api.current;
    if (!runtime || !props.alignmentMode) return;
    runtime.controls.enableRotate = false;
    runtime.controls.enablePan = false;
    runtime.focus();
  }, [props.alignmentMode]);
  return (
    <div
      className={
        props.roomDraw?.enabled ||
        props.roomStamp?.enabled ||
        props.roomPolygonDraw?.enabled
          ? "canvas-wrap room-draw-active"
          : "canvas-wrap"
      }
    >
      <div className="studio-canvas" ref={host} />
      {status && (
        <div className="canvas-status" role="status">
          {status}
        </div>
      )}
      {props.roomStamp?.enabled && (
        <div className="room-draw-hint">
          Click or tap once to place the exact room-sheet size · drag later to fine-tune
        </div>
      )}
      {props.roomDraw?.enabled && (
        <div className="room-draw-hint">
          Drag from one room corner to the opposite corner · release to map
        </div>
      )}
      {props.roomPolygonDraw?.enabled && (
        <div className="room-draw-hint">
          Click room corners · wall/vertex snap is active · click first corner
          or press Enter to finish · Esc cancels
        </div>
      )}
      {props.alignmentMode && (
        <div className="alignment-canvas-legend" aria-label="Alignment canvas legend">
          <span className="model-key">3D MODEL</span>
          <span className="plan-key">BLUE FADED = REFERENCE PLAN</span>
          <small>Move only on the flat X/Z plane · camera rotation is locked</small>
        </div>
      )}
      <button className="reset-camera" onClick={() => api.current?.focus()}>
        Reset view
      </button>
      {props.view === "walk" && (
        <div className="walk-pad">
          <span>
            Drag to look · WASD to walk · reviewed shared doors connect rooms
          </span>
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

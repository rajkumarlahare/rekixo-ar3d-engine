import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { isPointerTap } from "@rekixo/3d-engine-core";
import {
  applyModelProfileExterior,
  loadModelProfileMaterialEnhancer,
  type ModelProfileRuntime,
} from "@rekixo/3d-model-profiles";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { addFurnitureVisual } from "./furnitureVisual";
import { addSiteElementVisual } from "./siteElementVisual";
import { asset } from "./storage";
import { disposeObjectResources } from "./threeResources";
import { applySceneCanvasAppearance } from "./sceneCanvasAppearance";
import {
  applyModelMaterialOverrides,
  applyModelNodeVisibility,
} from "./sceneCanvasModel";
import {
  canWalk,
  reviewedDoorConnections,
  resolveReviewedDoorWalkStep,
  roomBoundaryPoints,
  type Asset,
  type Furniture,
  type Opening,
  type Room,
  type RoomPoint,
  type Scene as SceneData,
  type SiteElement,
} from "./domain";

export type View = "building" | "rooms" | "walk";

interface Props {
  resolveAsset?: (id: string) => Promise<Asset | undefined>;
  scene: SceneData;
  roomId: string;
  view: View;
  selected: string;
  onSelect: (id: string) => void;
  onMesh?: (name: string) => void;
  onWalkRoomChange?: (roomId: string, openingId: string) => void;
}

interface Runtime {
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  renderer: T.WebGLRenderer;
  controls: OrbitControls;
  model: T.Group;
  rooms: T.Group;
  site: T.Group;
  keys: Set<string>;
  walkRoomId: string;
  hemi: T.HemisphereLight;
  sun: T.DirectionalLight;
  fill: T.DirectionalLight;
  grid: T.GridHelper;
  profileExterior?: ModelProfileRuntime["exterior"];
  focus: () => void;
}

function presentationSiteElements(group: T.Group, elements: readonly SiteElement[]) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObjectResources(child);
  }
  for (const element of elements) {
    const root = new T.Group();
    root.position.set(element.x, element.y ?? 0, element.z);
    root.rotation.y = T.MathUtils.degToRad(element.rotation);
    addSiteElementVisual(root, element);
    group.add(root);
  }
}

function presentationFurniture(
  roomRoot: T.Group,
  roomId: string,
  furniture: readonly Furniture[],
) {
  for (const item of furniture) {
    if (item.roomId !== roomId) continue;
    const root = new T.Group();
    root.position.set(item.x, 0, item.z);
    root.rotation.y = T.MathUtils.degToRad(item.rotation);
    addFurnitureVisual(root, item);
    roomRoot.add(root);
  }
}

function presentationOpeningMarkers(
  root: T.Group,
  openings: readonly Opening[],
  options: { view: View; roomId: string },
) {
  for (const opening of openings) {
    if (!opening.reviewed) continue;
    if (options.view === "walk" && !opening.roomIds.includes(options.roomId))
      continue;

    const marker = new T.Mesh(
      new T.BoxGeometry(
        Math.max(0.08, opening.width),
        Math.max(0.08, opening.height),
        0.09,
      ),
      new T.MeshStandardMaterial({
        color: opening.kind === "door" ? 0xd0a45d : 0x72b9d6,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        roughness: 0.45,
        metalness: opening.kind === "window" ? 0.08 : 0,
      }),
    );
    marker.name = "Opening · " + opening.kind;
    marker.position.set(opening.x, opening.y, opening.z);
    marker.rotation.y = T.MathUtils.degToRad(opening.rotationY);
    marker.renderOrder = 24;
    root.add(marker);
  }
}

function presentationRoomSurface(
  root: T.Object3D,
  room: Room,
  height: number,
  selected: boolean,
  openings: readonly Opening[],
) {
  const world = roomBoundaryPoints(room);
  const local = world.map(
    ([x, z]) => [x - room.x, z - room.z] as RoomPoint,
  );
  const shape = new T.Shape();
  local.forEach(([x, z], index) => {
    if (!index) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  shape.closePath();

  const floor = new T.Mesh(
    new T.ShapeGeometry(shape),
    new T.MeshStandardMaterial({
      color: room.color,
      roughness: 0.78,
      side: T.DoubleSide,
    }),
  );
  floor.name = room.name;
  floor.rotation.x = Math.PI / 2;
  floor.position.y = -0.04;
  floor.receiveShadow = true;
  root.add(floor);

  const roomOpenings = openings.filter(
    (opening) => opening.reviewed && opening.roomIds.includes(room.id),
  );

  for (let index = 0; index < local.length; index += 1) {
    const left = local[index];
    const right = local[(index + 1) % local.length];
    const dx = right[0] - left[0];
    const dz = right[1] - left[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.03) continue;
    const ux = dx / length;
    const uz = dz / length;
    const worldLeft: RoomPoint = [left[0] + room.x, left[1] + room.z];
    const cuts = roomOpenings
      .map((opening) => {
        const vx = opening.x - worldLeft[0];
        const vz = opening.z - worldLeft[1];
        const along = vx * ux + vz * uz;
        const perpendicular = Math.abs(vx * -uz + vz * ux);
        if (
          perpendicular > 0.22 ||
          along < -opening.width / 2 ||
          along > length + opening.width / 2
        )
          return undefined;
        const start = Math.max(0, along - opening.width / 2);
        const end = Math.min(length, along + opening.width / 2);
        const bottom =
          opening.kind === "window"
            ? Math.max(0, opening.sillHeight ?? 0.9)
            : Math.max(0, opening.sillHeight ?? 0);
        const top = Math.min(height, bottom + opening.height);
        if (end - start < 0.02 || top <= 0 || bottom >= height)
          return undefined;
        return {
          start,
          end,
          bottom: Math.min(height, bottom),
          top: Math.max(0, top),
        };
      })
      .filter(
        (
          cut,
        ): cut is {
          start: number;
          end: number;
          bottom: number;
          top: number;
        } => Boolean(cut),
      );

    const boundaries = Array.from(
      new Set([0, length, ...cuts.flatMap((cut) => [cut.start, cut.end])]),
    ).sort((a, b) => a - b);
    const wallRotation = Math.atan2(-dz, dx);
    const wallMaterial = new T.MeshStandardMaterial({
      color: index % 2 ? "#e7e0d5" : "#eee9df",
      roughness: 0.82,
    });

    const addPiece = (
      from: number,
      to: number,
      bottom: number,
      top: number,
    ) => {
      const pieceLength = to - from;
      const pieceHeight = top - bottom;
      if (pieceLength < 0.02 || pieceHeight < 0.02) return;
      const mid = (from + to) / 2;
      const wall = new T.Mesh(
        new T.BoxGeometry(pieceLength, pieceHeight, 0.12),
        wallMaterial,
      );
      wall.name = "wall";
      wall.position.set(
        left[0] + ux * mid,
        bottom + pieceHeight / 2,
        left[1] + uz * mid,
      );
      wall.rotation.y = wallRotation;
      wall.castShadow = true;
      wall.receiveShadow = true;
      root.add(wall);
    };

    for (let part = 0; part + 1 < boundaries.length; part += 1) {
      const from = boundaries[part];
      const to = boundaries[part + 1];
      if (to - from < 0.02) continue;
      const mid = (from + to) / 2;
      const active = cuts.filter(
        (cut) => mid >= cut.start - 1e-5 && mid <= cut.end + 1e-5,
      );
      if (!active.length) {
        addPiece(from, to, 0, height);
        continue;
      }
      const bottom = Math.min(...active.map((cut) => cut.bottom));
      const top = Math.max(...active.map((cut) => cut.top));
      if (bottom > 0.02) addPiece(from, to, 0, bottom);
      if (top < height - 0.02) addPiece(from, to, top, height);
    }
  }

  if (selected) {
    const helper = new T.BoxHelper(root, 0x148575);
    root.updateMatrixWorld(true);
    helper.update();
    root.parent?.add(helper);
  }
}

export default function PresentationCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const runtime = useRef<Runtime | null>(null);
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
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Published 3D presentation");
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
    sun.shadow.bias = -0.00012;
    sun.shadow.normalBias = 0.025;
    Object.assign(sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 30,
      bottom: -30,
    });
    scene.add(sun);
    const fill = new T.DirectionalLight(0xdde8f3, 0.72);
    fill.position.set(12, 16, -18);
    scene.add(fill);
    const grid = new T.GridHelper(100, 100, 0xa9b4bd, 0xcbd3d9);
    grid.position.y = -0.05;
    scene.add(grid);

    const model = new T.Group();
    const rooms = new T.Group();
    const site = new T.Group();
    scene.add(model, rooms, site);

    const keys = new Set<string>();
    let yaw = 0;
    let pitch = 0;
    const roomFloor = () => {
      const current = latest.current;
      const activeRoomId =
        current.view === "walk"
          ? runtime.current?.walkRoomId || current.roomId
          : current.roomId;
      const room = current.scene.rooms.find(
        (candidate) => candidate.id === activeRoomId,
      );
      return {
        room,
        y:
          current.scene.floors.find((floor) => floor.id === room?.floorId)
            ?.elevation ?? 0,
      };
    };

    const focus = () => {
      const current = latest.current;
      const { room, y } = roomFloor();
      if (current.view === "walk" && room) {
        let start: [number, number] = [
          room.x,
          room.z + room.depth / 2 - 0.4,
        ];
        if (!canWalk(current.scene, room, ...start)) {
          const candidates: [number, number][] = [];
          for (
            let z = -room.depth / 2 + 0.3;
            z < room.depth / 2 - 0.2;
            z += 0.3
          )
            for (
              let x = -room.width / 2 + 0.3;
              x < room.width / 2 - 0.2;
              x += 0.3
            )
              if (canWalk(current.scene, room, room.x + x, room.z + z))
                candidates.push([room.x + x, room.z + z]);
          if (candidates.length) start = candidates[0];
        }
        camera.position.set(start[0], y + 1.6, start[1]);
        yaw = Math.atan2(start[0] - room.x, start[1] - room.z);
        pitch = -0.12;
        camera.lookAt(room.x, y + 1.3, room.z);
        const connections = reviewedDoorConnections(current.scene, room.id).length;
        setStatus(
          connections
            ? `${room.name} · ${connections} reviewed door connection${connections === 1 ? "" : "s"}`
            : `${room.name} · no reviewed room-to-room doors`,
        );
        return;
      }

      let box: T.Box3;
      if (current.view === "building") {
        if (model.children.length) box = new T.Box3().setFromObject(model);
        else if (site.children.length) box = new T.Box3().setFromObject(site);
        else
          box = new T.Box3(
            new T.Vector3(-5, 0, -5),
            new T.Vector3(5, 3, 5),
          );
      } else if (room) {
        const boundary = roomBoundaryPoints(room);
        const minX = Math.min(...boundary.map((point) => point[0]));
        const maxX = Math.max(...boundary.map((point) => point[0]));
        const minZ = Math.min(...boundary.map((point) => point[1]));
        const maxZ = Math.max(...boundary.map((point) => point[1]));
        box = new T.Box3(
          new T.Vector3(minX, y, minZ),
          new T.Vector3(maxX, y + room.height, maxZ),
        );
      } else {
        box = new T.Box3(
          new T.Vector3(-5, 0, -5),
          new T.Vector3(5, 3, 5),
        );
      }
      const centre = box.getCenter(new T.Vector3());
      const size = box.getSize(new T.Vector3());
      const distance =
        (Math.max(size.y, size.x / camera.aspect, size.z / camera.aspect, 4) /
          Math.tan((camera.fov * Math.PI) / 360)) *
        0.8;
      controls.target.copy(centre);
      camera.position
        .copy(centre)
        .add(new T.Vector3(-1, 0.7, 1).normalize().multiplyScalar(distance));
      controls.update();
      setStatus("");
    };

    runtime.current = {
      scene,
      camera,
      renderer,
      controls,
      model,
      rooms,
      site,
      keys,
      walkRoomId: props.roomId,
      hemi,
      sun,
      fill,
      grid,
      focus,
    };

    const resize = new ResizeObserver(() => {
      camera.aspect =
        Math.max(el.clientWidth, 1) / Math.max(el.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    resize.observe(el);

    const down = (event: KeyboardEvent) => {
      if (latest.current.view !== "walk") return;
      const key = event.key.toLowerCase();
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
        ].includes(key)
      ) {
        event.preventDefault();
        keys.add(key);
      }
    };
    const up = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    const blur = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);

    let point:
      | { x: number; y: number; ox: number; oy: number; id: number }
      | undefined;
    const pointerDown = (event: PointerEvent) => {
      renderer.domElement.focus();
      point = {
        x: event.clientX,
        y: event.clientY,
        ox: event.clientX,
        oy: event.clientY,
        id: event.pointerId,
      };
      if (latest.current.view === "walk")
        renderer.domElement.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!point || latest.current.view !== "walk") return;
      yaw -= (event.clientX - point.x) * 0.004;
      pitch = T.MathUtils.clamp(
        pitch - (event.clientY - point.y) * 0.004,
        -1.2,
        1.2,
      );
      point.x = event.clientX;
      point.y = event.clientY;
    };
    const pointerUp = (event: PointerEvent) => {
      if (!point) return;
      const small = isPointerTap(
        { clientX: point.ox, clientY: point.oy },
        event,
      );
      point = undefined;
      if (latest.current.view === "walk") {
        try {
          renderer.domElement.releasePointerCapture(event.pointerId);
        } catch {}
        return;
      }
      if (!small) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new T.Raycaster();
      ray.setFromCamera(
        new T.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(rooms.children, true)[0];
      let node: T.Object3D | null = hit?.object ?? null;
      while (node && !node.userData.selectId) node = node.parent;
      if (node?.userData.selectId)
        latest.current.onSelect(String(node.userData.selectId));
    };

    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerUp);

    let previous = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const { room } = roomFloor();
      if (latest.current.view === "walk" && room) {
        const forward =
          Number(keys.has("w") || keys.has("arrowup")) -
          Number(keys.has("s") || keys.has("arrowdown"));
        const side =
          Number(keys.has("d") || keys.has("arrowright")) -
          Number(keys.has("a") || keys.has("arrowleft"));
        const step = (dt * 1.5) / Math.max(1, Math.hypot(forward, side));
        const dx =
          (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * step;
        const dz =
          (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * step;
        if (Math.abs(dx) > 0.000001 || Math.abs(dz) > 0.000001) {
          const sceneData = latest.current.scene;
          const fromX = camera.position.x;
          const fromZ = camera.position.z;
          let resolved = resolveReviewedDoorWalkStep(
            sceneData,
            room,
            fromX,
            fromZ,
            fromX + dx,
            fromZ + dz,
          );
          if (
            resolved.roomId === room.id &&
            resolved.x === fromX &&
            resolved.z === fromZ
          ) {
            const slideX = resolveReviewedDoorWalkStep(
              sceneData,
              room,
              fromX,
              fromZ,
              fromX + dx,
              fromZ,
            );
            if (
              slideX.roomId !== room.id ||
              slideX.x !== fromX ||
              slideX.z !== fromZ
            )
              resolved = slideX;
            else
              resolved = resolveReviewedDoorWalkStep(
                sceneData,
                room,
                fromX,
                fromZ,
                fromX,
                fromZ + dz,
              );
          }
          camera.position.x = resolved.x;
          camera.position.z = resolved.z;
          if (resolved.roomId !== room.id && resolved.openingId) {
            runtime.current!.walkRoomId = resolved.roomId;
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
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);
    focus();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointercancel", pointerUp);
      controls.dispose();
      disposeObjectResources(scene);
      renderer.dispose();
      el.replaceChildren();
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    let cancelled = false;
    let finishCleanup: (() => void) | undefined;
    for (const child of [...current.model.children]) {
      current.model.remove(child);
      disposeObjectResources(child);
    }
    current.profileExterior = undefined;
    current.scene.background = new T.Color(
      props.scene.appearance?.background ?? "#dbe3e7",
    );
    if (!props.scene.modelId) {
      setStatus("");
      current.focus();
      return;
    }

    setStatus("Loading model…");
    void (async () => {
      const file = await (props.resolveAsset ?? asset)(props.scene.modelId!);
      if (!file) throw Error("Model missing from published snapshot.");
      const data = await file.blob.arrayBuffer();
      const manager = new T.LoadingManager();
      manager.setURLModifier((url) => {
        if (url.startsWith("blob:") || url.startsWith("data:")) return url;
        throw Error(
          "External model resources are unavailable. Publish a self-contained GLB with embedded textures.",
        );
      });

      let object: T.Group;
      if (file.name.toLowerCase().endsWith(".fbx")) {
        object = new FBXLoader(manager).parse(data, "");
      } else {
        const loader = new GLTFLoader(manager);
        loader.setMeshoptDecoder(MeshoptDecoder);
        object = (await loader.parseAsync(data, "")).scene;
      }
      if (cancelled) {
        disposeObjectResources(object);
        return;
      }

      let meshIndex = 0;
      const occurrences = new Map<string, number>();
      object.updateWorldMatrix(true, true);
      object.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        meshIndex += 1;
        if (!node.name) node.name = `Mesh ${meshIndex}`;
        const occurrence = (occurrences.get(node.name) ?? 0) + 1;
        occurrences.set(node.name, occurrence);
        node.userData.studioNodeName = node.name;
        node.userData.studioNodeOccurrence = occurrence;
        node.castShadow = true;
        node.receiveShadow = true;
      });

      const referenceVisual = props.scene.appearance?.referenceVisual ?? true;
      const modelProfile = applyModelProfileExterior(object, referenceVisual);
      current.profileExterior = modelProfile?.exterior;
      if (modelProfile?.exterior) {
        modelProfile.exterior.setNight(props.scene.appearance?.nightMode ?? false);
        finishCleanup = modelProfile.exterior.dispose;
      }
      const materialEnhancer = await loadModelProfileMaterialEnhancer(modelProfile);
      materialEnhancer?.(object, current.renderer, referenceVisual);
      current.model.add(object);

      const alignment = props.scene.modelTransform ?? {
        x: 0,
        y: 0,
        z: 0,
        rotationY: 0,
      };
      current.model.position.set(alignment.x, alignment.y, alignment.z);
      current.model.rotation.y = T.MathUtils.degToRad(alignment.rotationY);
      current.model.scale.setScalar(props.scene.scale);
      applyModelMaterialOverrides(current.model, props.scene);
      applyModelNodeVisibility(current.model, props.scene);
      applySceneCanvasAppearance(
        current,
        props.scene.appearance,
        false,
      );
      current.focus();
      setStatus(
        file.name.toLowerCase().endsWith(".fbx")
          ? "FBX loaded from published snapshot."
          : "",
      );
    })().catch((reason) => {
      if (!cancelled)
        setStatus(
          reason instanceof Error ? reason.message : "Model loading failed.",
        );
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
    const current = runtime.current;
    if (!current) return;
    const alignment = props.scene.modelTransform ?? {
      x: 0,
      y: 0,
      z: 0,
      rotationY: 0,
    };
    current.model.position.set(alignment.x, alignment.y, alignment.z);
    current.model.rotation.y = T.MathUtils.degToRad(alignment.rotationY);
    current.model.scale.setScalar(props.scene.scale);
    current.model.visible = props.view === "building";
    current.site.visible = props.view === "building";
    current.rooms.visible = props.view !== "building";
    current.controls.enabled = props.view !== "walk";

    presentationSiteElements(
      current.site,
      props.view === "building" ? props.scene.siteElements ?? [] : [],
    );
    for (const child of [...current.rooms.children]) {
      current.rooms.remove(child);
      disposeObjectResources(child);
    }

    if (props.view !== "building") {
      for (const room of props.scene.rooms) {
        if (props.view === "walk" && room.id !== props.roomId) continue;
        const root = new T.Group();
        root.userData.selectId = room.id;
        root.position.set(
          room.x,
          props.scene.floors.find((floor) => floor.id === room.floorId)
            ?.elevation ?? 0,
          room.z,
        );
        current.rooms.add(root);
        presentationRoomSurface(
          root,
          room,
          props.view === "walk" ? room.height : 0.65,
          room.id === props.selected,
          props.scene.openings ?? [],
        );
        presentationFurniture(root, room.id, props.scene.furniture);
      }
      presentationOpeningMarkers(
        current.rooms,
        props.scene.openings ?? [],
        { view: props.view, roomId: props.roomId },
      );
    }
    current.focus();
  }, [props.scene, props.view, props.roomId, props.selected]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    applyModelMaterialOverrides(current.model, props.scene);
  }, [props.scene.materialOverrides, props.scene.modelId]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    applySceneCanvasAppearance(current, props.scene.appearance, false);
  }, [props.scene.appearance, props.scene.modelId]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.walkRoomId = props.roomId;
    current.focus();
  }, [props.roomId, props.view]);

  return (
    <div className="canvas-wrap">
      <div className="studio-canvas" ref={host} />
      {status ? (
        <div className="canvas-status" role="status">
          {status}
        </div>
      ) : null}
      <button className="reset-camera" onClick={() => runtime.current?.focus()}>
        Reset view
      </button>
      {props.view === "walk" ? (
        <div className="walk-pad">
          <span>
            Drag to look · WASD inside room · reviewed shared doors connect rooms
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
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                runtime.current?.keys.add(key);
              }}
              onPointerUp={() => runtime.current?.keys.delete(key)}
              onPointerCancel={() => runtime.current?.keys.delete(key)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

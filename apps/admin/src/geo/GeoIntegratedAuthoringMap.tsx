import { buildGeoRigidPlacementPlan, type GeoRigidPlacement } from "@rekixo/3d-engine-core";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { GeoHeightMode, GeoV2Anchor } from "./geoV2Api";

export type GeoIntegratedPreviewState =
  | "map-key-required"
  | "loading-map"
  | "map-ready"
  | "loading-model"
  | "waiting-coordinate"
  | "waiting-anchor"
  | "invalid-alignment"
  | "ready"
  | "error";

type Coordinate = { latitude: number; longitude: number };

type AuthoringPlacement = GeoRigidPlacement & {
  altitudeM: number;
  heightMode: GeoHeightMode;
};

type Props = {
  apiKey: string;
  projectKey: string;
  modelUrl: string | null;
  modelName: string;
  coordinate: Coordinate | null;
  anchor: GeoV2Anchor | null;
  placement: AuthoringPlacement | null;
  onCoordinateChange(latitude: number, longitude: number): void;
  onPreviewStateChange(state: GeoIntegratedPreviewState): void;
};

type MapsListener = { remove(): void };
type LatLngLike = { lat(): number; lng(): number };
type MapMouseEvent = { latLng?: LatLngLike | null };
type GoogleMap = {
  addListener(name: string, listener: (event: MapMouseEvent) => void): MapsListener;
  setCenter(position: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
  moveCamera?(options: Record<string, unknown>): void;
};
type GoogleMarker = {
  setMap(map: GoogleMap | null): void;
  setPosition(position: { lat: number; lng: number }): void;
  addListener(name: string, listener: () => void): MapsListener;
  getPosition(): LatLngLike | null;
};
type WebGLTransformer = {
  fromLatLngAltitude(input: { lat: number; lng: number; altitude: number }): number[];
};
type WebGLDrawOptions = {
  gl: WebGLRenderingContext;
  transformer: WebGLTransformer;
};
type WebGLContextOptions = { gl: WebGLRenderingContext };
type GoogleWebGLOverlay = {
  onContextRestored?: (options: WebGLContextOptions) => void;
  onDraw?: (options: WebGLDrawOptions) => void;
  onContextLost?: () => void;
  onRemove?: () => void;
  setMap(map: GoogleMap | null): void;
  requestRedraw(): void;
};
type GoogleRoot = {
  maps: {
    Map: new (node: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    WebGLOverlayView?: new () => GoogleWebGLOverlay;
  };
};
type GeoWindow = Window & typeof globalThis & {
  google?: GoogleRoot;
  __rekixoEngineGeoV2MapsReady?: () => void;
};

type PlacementNodes = {
  root: THREE.Group;
  yUpToEnu: THREE.Group;
  anchorOffset: THREE.Group;
};

const INDIA_FALLBACK = { lat: 20.5937, lng: 78.9629 };
let mapsPromise: Promise<GoogleRoot> | null = null;
let mapsKeyLoaded = "";

function loadGoogleMaps(apiKey: string) {
  const geoWindow = window as GeoWindow;
  if (geoWindow.google?.maps?.Map && mapsKeyLoaded === apiKey)
    return Promise.resolve(geoWindow.google);
  if (mapsPromise && mapsKeyLoaded === apiKey) return mapsPromise;

  mapsKeyLoaded = apiKey;
  mapsPromise = new Promise<GoogleRoot>((resolve, reject) => {
    const callback = "__rekixoEngineGeoV2MapsReady";
    geoWindow[callback] = () => {
      if (geoWindow.google?.maps?.Map) resolve(geoWindow.google);
      else reject(new Error("Google Maps initialize nahi hui."));
    };
    document.getElementById("rekixo-engine-geo-v2-maps-js")?.remove();
    const script = document.createElement("script");
    script.id = "rekixo-engine-geo-v2-maps-js";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error("Google Maps load nahi hui."));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

async function loadModel(modelUrl: string, signal: AbortSignal) {
  const response = await fetch(modelUrl, {
    cache: "force-cache",
    headers: { Accept: "model/gltf-binary,application/octet-stream" },
    signal,
  });
  if (!response.ok)
    throw new Error(`Immutable Building preview load failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(
      bytes,
      "",
      (gltf) => resolve(gltf.scene),
      (reason) => reject(
        reason instanceof Error
          ? reason
          : new Error("Immutable Building GLB parse failed."),
      ),
    );
  });
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry?.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function projectionAltitude(placement: AuthoringPlacement | null) {
  if (!placement || placement.heightMode !== "absolute") return 0;
  return placement.altitudeM;
}

function applyPlacement(nodes: PlacementNodes, anchor: GeoV2Anchor, placement: AuthoringPlacement) {
  const plan = buildGeoRigidPlacementPlan(
    { x: anchor.xM, y: anchor.yM, z: anchor.zM },
    placement,
  );
  nodes.root.position.set(plan.positionM.x, plan.positionM.y, plan.positionM.z);
  nodes.root.rotation.order = "ZYX";
  nodes.root.rotation.set(
    plan.rotationRad.x,
    plan.rotationRad.y,
    plan.rotationRad.z,
  );
  nodes.root.scale.setScalar(plan.scale);
  nodes.yUpToEnu.rotation.set(plan.yUpToEnuRotationXRad, 0, 0);
  nodes.anchorOffset.position.set(
    plan.anchorOffsetM.x,
    plan.anchorOffsetM.y,
    plan.anchorOffsetM.z,
  );
}

export default function GeoIntegratedAuthoringMap({
  apiKey,
  projectKey,
  modelUrl,
  modelName,
  coordinate,
  anchor,
  placement,
  onCoordinateChange,
  onPreviewStateChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const overlayRef = useRef<GoogleWebGLOverlay | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const nodesRef = useRef<PlacementNodes | null>(null);
  const coordinateRef = useRef<Coordinate | null>(coordinate);
  const placementRef = useRef<AuthoringPlacement | null>(placement);
  const coordinateChangeRef = useRef(onCoordinateChange);
  const previewStateChangeRef = useRef(onPreviewStateChange);
  const [mapReady, setMapReady] = useState(false);
  const [webglReady, setWebglReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [mapFailure, setMapFailure] = useState("");
  const [modelFailure, setModelFailure] = useState("");

  coordinateRef.current = coordinate;
  placementRef.current = placement;
  coordinateChangeRef.current = onCoordinateChange;
  previewStateChangeRef.current = onPreviewStateChange;

  useEffect(() => {
    if (!apiKey || !hostRef.current) {
      setMapReady(false);
      return;
    }

    let cancelled = false;
    let mapClick: MapsListener | null = null;
    let markerDrag: MapsListener | null = null;
    let overlay: GoogleWebGLOverlay | null = null;
    let marker: GoogleMarker | null = null;
    setMapReady(false);
    setWebglReady(false);
    setFrameReady(false);
    setMapFailure("");

    void loadGoogleMaps(apiKey)
      .then((google) => {
        if (cancelled || !hostRef.current) return;
        const WebGLOverlayView = google.maps.WebGLOverlayView;
        if (!WebGLOverlayView)
          throw new Error("This browser/map runtime does not expose WebGLOverlayView.");

        const initial = coordinateRef.current;
        const center = initial
          ? { lat: initial.latitude, lng: initial.longitude }
          : INDIA_FALLBACK;
        const map = new google.maps.Map(hostRef.current, {
          center,
          zoom: initial ? 19 : 5,
          tilt: initial ? 55 : 0,
          heading: 0,
          mapId: "DEMO_MAP_ID",
          streetViewControl: false,
          mapTypeControl: true,
          fullscreenControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        mapRef.current = map;

        marker = new google.maps.Marker({
          map,
          position: center,
          draggable: true,
          title: "WGS84 Building anchor",
        });
        markerRef.current = marker;

        const setCoordinate = (lat: number, lng: number) => {
          coordinateChangeRef.current(lat, lng);
        };
        mapClick = map.addListener("click", (event) => {
          if (!event.latLng) return;
          const next = { lat: event.latLng.lat(), lng: event.latLng.lng() };
          marker?.setPosition(next);
          setCoordinate(next.lat, next.lng);
        });
        markerDrag = marker.addListener("dragend", () => {
          const next = marker?.getPosition();
          if (next) setCoordinate(next.lat(), next.lng());
        });

        const scene = new THREE.Scene();
        const camera = new THREE.Camera();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x66717b, 1.35));
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(30, -20, 60);
        scene.add(sun);
        sceneRef.current = scene;
        cameraRef.current = camera;

        overlay = new WebGLOverlayView();
        overlayRef.current = overlay;
        overlay.onContextRestored = ({ gl }) => {
          if (cancelled) return;
          const renderer = new THREE.WebGLRenderer({
            canvas: gl.canvas as HTMLCanvasElement,
            context: gl,
            antialias: true,
          });
          renderer.autoClear = false;
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 0.95;
          rendererRef.current = renderer;
          setWebglReady(true);
          overlay?.requestRedraw();
        };
        overlay.onDraw = ({ gl, transformer }) => {
          const renderer = rendererRef.current;
          const drawCamera = cameraRef.current;
          const drawScene = sceneRef.current;
          if (cancelled || !renderer || !drawCamera || !drawScene) return;
          const current = coordinateRef.current;
          const anchorCoordinate = current
            ? { lat: current.latitude, lng: current.longitude }
            : center;
          drawCamera.projectionMatrix.fromArray(
            transformer.fromLatLngAltitude({
              ...anchorCoordinate,
              altitude: projectionAltitude(placementRef.current),
            }),
          );
          renderer.resetState();
          renderer.render(drawScene, drawCamera);
          gl.flush();
          if (nodesRef.current?.root.visible) setFrameReady(true);
        };
        overlay.onContextLost = () => {
          rendererRef.current?.dispose();
          rendererRef.current = null;
          setWebglReady(false);
        };
        overlay.onRemove = () => {
          rendererRef.current?.dispose();
          rendererRef.current = null;
          setWebglReady(false);
        };
        overlay.setMap(map);
        setMapReady(true);
      })
      .catch((reason) => {
        if (cancelled) return;
        setMapFailure(reason instanceof Error ? reason.message : "Integrated Geo map initialize nahi hui.");
        setMapReady(false);
      });

    return () => {
      cancelled = true;
      mapClick?.remove();
      markerDrag?.remove();
      marker?.setMap(null);
      overlay?.setMap(null);
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setWebglReady(false);
      mapRef.current = null;
      markerRef.current = null;
      overlayRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      nodesRef.current = null;
      if (hostRef.current) hostRef.current.replaceChildren();
    };
  }, [apiKey, projectKey]);

  useEffect(() => {
    if (!mapReady || !sceneRef.current || !modelUrl) {
      setModelReady(false);
      return;
    }

    const controller = new AbortController();
    let loadedModel: THREE.Object3D | null = null;
    let nodes: PlacementNodes | null = null;
    setModelReady(false);
    setFrameReady(false);
    setModelFailure("");

    void loadModel(modelUrl, controller.signal)
      .then((model) => {
        if (controller.signal.aborted || !sceneRef.current) {
          disposeObject(model);
          return;
        }
        loadedModel = model;
        model.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.frustumCulled = true;
          node.castShadow = false;
          node.receiveShadow = false;
        });

        const root = new THREE.Group();
        root.name = "rekixo-admin-rigid-geo-building";
        const yUpToEnu = new THREE.Group();
        yUpToEnu.name = "rekixo-y-up-to-enu";
        const anchorOffset = new THREE.Group();
        anchorOffset.name = "rekixo-building-anchor-offset";
        anchorOffset.add(model);
        yUpToEnu.add(anchorOffset);
        root.add(yUpToEnu);
        root.visible = false;
        sceneRef.current.add(root);
        nodes = { root, yUpToEnu, anchorOffset };
        nodesRef.current = nodes;
        setModelReady(true);
        overlayRef.current?.requestRedraw();
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setModelFailure(reason instanceof Error ? reason.message : "Building preview load nahi hui.");
        setModelReady(false);
      });

    return () => {
      controller.abort();
      if (nodes && sceneRef.current) sceneRef.current.remove(nodes.root);
      if (nodesRef.current === nodes) nodesRef.current = null;
      if (loadedModel) disposeObject(loadedModel);
    };
  }, [mapReady, modelUrl]);

  useEffect(() => {
    setFrameReady(false);
    if (coordinate) {
      const next = { lat: coordinate.latitude, lng: coordinate.longitude };
      markerRef.current?.setPosition(next);
    }

    const nodes = nodesRef.current;
    if (nodes) {
      if (coordinate && anchor && placement) {
        try {
          applyPlacement(nodes, anchor, placement);
          nodes.root.visible = true;
        } catch {
          nodes.root.visible = false;
        }
      } else {
        nodes.root.visible = false;
      }
    }
    overlayRef.current?.requestRedraw();
  }, [coordinate, anchor, placement]);

  useEffect(() => {
    let next: GeoIntegratedPreviewState;
    if (!apiKey) next = "map-key-required";
    else if (mapFailure || modelFailure) next = "error";
    else if (!mapReady || !webglReady) next = "loading-map";
    else if (!coordinate) next = "waiting-coordinate";
    else if (!modelUrl) next = "map-ready";
    else if (!modelReady) next = "loading-model";
    else if (!anchor) next = "waiting-anchor";
    else if (!placement) next = "invalid-alignment";
    else if (!frameReady) next = "loading-model";
    else next = "ready";
    previewStateChangeRef.current(next);
  }, [apiKey, mapFailure, modelFailure, mapReady, webglReady, modelReady, frameReady, modelUrl, coordinate, anchor, placement]);

  const recenter = () => {
    if (!coordinate || !mapRef.current) return;
    mapRef.current.moveCamera?.({
      center: { lat: coordinate.latitude, lng: coordinate.longitude },
      zoom: 19,
    });
    if (!mapRef.current.moveCamera) {
      mapRef.current.setCenter({ lat: coordinate.latitude, lng: coordinate.longitude });
      mapRef.current.setZoom(19);
    }
  };

  const setTopView = () => {
    mapRef.current?.moveCamera?.({ tilt: 0, heading: 0, zoom: 20 });
  };

  const setThreeDView = () => {
    mapRef.current?.moveCamera?.({ tilt: 60, heading: 0, zoom: 19 });
  };

  const status = mapFailure || modelFailure || (
    !apiKey ? "Google Maps browser key save karein." :
      !mapReady || !webglReady ? "Integrated 3D map initialize ho rahi hai…" :
        !coordinate ? "Map par Building ka real WGS84 anchor set karein." :
          !modelUrl ? "Active immutable Building release select karein." :
            !modelReady ? `Immutable Building load ho rahi hai: ${modelName}` :
              !anchor ? "Exact Building-local model anchor select karein." :
                !placement ? "Geo alignment values valid range me karein." :
                  !frameReady ? "Current placement map par render ho rahi hai…" :
                    "Integrated Building preview ready"
  );

  return (
    <div className="geo-v2-integrated-authoring">
      <div ref={hostRef} className="geo3d-map geo-v2-integrated-map" aria-label="Integrated 3D Geo authoring map" />
      <div className="geo-v2-map-tools" aria-label="Geo map view controls">
        <button type="button" disabled={!mapReady} onClick={recenter}>Recenter</button>
        <button type="button" disabled={!mapReady} onClick={setTopView}>Top</button>
        <button type="button" disabled={!mapReady} onClick={setThreeDView}>3D</button>
      </div>
      <div className={`geo-v2-map-status${mapFailure || modelFailure ? " geo-v2-map-status--error" : ""}`} role="status">
        <span>AUTHORING PREVIEW</span>
        <strong>{status}</strong>
      </div>
    </div>
  );
}

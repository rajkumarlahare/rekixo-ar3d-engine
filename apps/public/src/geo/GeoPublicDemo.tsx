import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Viewer3D } from "../viewer/Viewer3D";
import { applyRigidBuildingPlacement } from "./geoRigidTransform";
import "./geo-public-demo.css";

type GeoCoordinate = {
  longitude: number;
  latitude: number;
  altitudeM?: number;
};

type GeoPayload = {
  project: { id: string; slug: string; name: string; location?: string };
  buildingRelease: {
    id: string;
    version: number;
    manifestSha256: string;
  };
  geoRelease: {
    id: string;
    version: number;
    manifestSha256: string;
    manifestFormat?: string;
    sourceDraftRevision: number;
    createdAt?: string;
  };
  placement: {
    coordinateReferenceSystem: "WGS84";
    localFrame: "ENU";
    units: "m";
    anchor: GeoCoordinate;
    heightMode: "ground-clamped" | "ground-relative" | "absolute";
    eastOffsetM: number;
    northOffsetM: number;
    verticalOffsetM: number;
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
    scale: number;
  };
  modelAnchor: {
    id: string;
    name: string;
    kind: string;
    localPositionM: { x: number; y: number; z: number };
  };
  runtime?: {
    integratedScene?: boolean;
    qualityTiers?: string[];
    buildingTransform?: string;
  };
  maps: {
    apiKey: string | null;
    mapId: string | null;
    apiKeyConfigured?: boolean;
    mapIdConfigured?: boolean;
    configured: boolean;
  };
  model: {
    id: string;
    name: string;
    mimeType: string;
    byteSize?: number;
    url: string;
    variant?: string;
    sha256?: string;
    sourceSha256?: string;
  };
  error?: string;
};

type MapCapabilities = { isWebGLOverlayViewAvailable?: boolean };
type GoogleMap = {
  setCenter(position: { lat: number; lng: number }): void;
  moveCamera?(options: Record<string, unknown>): void;
  getRenderingType?(): string;
  getMapCapabilities?(): MapCapabilities;
};

type WebGLTransformer = {
  fromLatLngAltitude(input: {
    lat: number;
    lng: number;
    altitude: number;
  }): number[];
};

type WebGLDrawOptions = {
  gl: WebGLRenderingContext;
  transformer: WebGLTransformer;
};

type WebGLContextOptions = { gl: WebGLRenderingContext };

type GoogleWebGLOverlay = {
  onAdd?: () => void;
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
    WebGLOverlayView?: new () => GoogleWebGLOverlay;
    RenderingType?: { VECTOR?: string; RASTER?: string; UNINITIALIZED?: string };
  };
};

type GeoWindow = Window &
  typeof globalThis & {
    google?: GoogleRoot;
    __rekixoPublicGeoMapsReady?: () => void;
  };

const WEBGL_CONTEXT_TIMEOUT_MS = 12_000;
let mapsPromise: Promise<GoogleRoot> | null = null;
let mapsKeyLoaded = "";

function loadGoogleMaps(apiKey: string) {
  const geoWindow = window as GeoWindow;
  if (geoWindow.google?.maps?.Map && mapsKeyLoaded === apiKey)
    return Promise.resolve(geoWindow.google);
  if (mapsPromise && mapsKeyLoaded === apiKey) return mapsPromise;

  mapsKeyLoaded = apiKey;
  mapsPromise = new Promise<GoogleRoot>((resolve, reject) => {
    const callback = "__rekixoPublicGeoMapsReady";
    geoWindow[callback] = () => {
      if (geoWindow.google?.maps?.Map) resolve(geoWindow.google);
      else reject(new Error("Google Maps initialize nahi hui."));
    };
    const existing = document.getElementById("rekixo-public-geo-maps-js");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "rekixo-public-geo-maps-js";
    script.async = true;
    script.defer = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error("Google Maps load nahi hui."));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

function browserSupportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function renderingTypeLabel(map: GoogleMap) {
  return String(map.getRenderingType?.() || "UNKNOWN").toUpperCase();
}

function webglTimeoutMessage(map: GoogleMap) {
  const capabilities = map.getMapCapabilities?.();
  if (capabilities?.isWebGLOverlayViewAvailable === false)
    return "Configured Google Maps Map ID WebGLOverlayView support expose nahi kar raha. JavaScript Vector Map ID, billing aur browser hardware acceleration verify karein.";
  const renderingType = renderingTypeLabel(map);
  if (renderingType.includes("RASTER"))
    return "Google Maps raster mode mila after vector startup window. API key aur production JavaScript Vector Map ID same Cloud project me verify karein.";
  if (!browserSupportsWebGL())
    return "Browser WebGL unavailable hai. Hardware acceleration/WebGL enable karke reload karein.";
  return `Integrated vector WebGL context ${WEBGL_CONTEXT_TIMEOUT_MS / 1000}s me ready nahi hua (${renderingType}).`;
}

function sha256Hex(bytes: ArrayBuffer) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
  );
}

async function loadVerifiedModel(model: GeoPayload["model"]) {
  const response = await fetch(model.url, {
    headers: { Accept: "model/gltf-binary,application/octet-stream" },
    cache: "force-cache",
  });
  if (!response.ok)
    throw new Error(`Immutable Geo model load failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (model.byteSize !== undefined && bytes.byteLength !== model.byteSize)
    throw new Error("Immutable Geo model byte-size verification failed.");
  if (model.sha256 && (await sha256Hex(bytes)) !== model.sha256.toLowerCase())
    throw new Error("Immutable Geo model checksum verification failed.");
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(
      bytes,
      "",
      (gltf) => resolve(gltf.scene),
      (reason) =>
        reject(
          reason instanceof Error
            ? reason
            : new Error("Immutable Geo GLB parse failed."),
        ),
    );
  });
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry?.dispose();
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function mapAltitude(data: GeoPayload) {
  return data.placement.heightMode === "absolute"
    ? Number(data.placement.anchor.altitudeM || 0)
    : 0;
}

function IntegratedGeoScene({ data }: { data: GeoPayload }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [quality, setQuality] = useState("Preparing integrated 3D map");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!hostRef.current || !data.maps.apiKey || !data.maps.mapId) return;
    let cancelled = false;
    let overlay: GoogleWebGLOverlay | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let loadedModel: THREE.Object3D | undefined;
    let root: THREE.Group | undefined;
    let contextTimer: number | undefined;
    let contextRestored = false;

    const clearContextTimer = () => {
      if (contextTimer !== undefined) window.clearTimeout(contextTimer);
      contextTimer = undefined;
    };

    Promise.all([loadGoogleMaps(data.maps.apiKey), loadVerifiedModel(data.model)])
      .then(([google, model]) => {
        if (cancelled || !hostRef.current) {
          disposeObject(model);
          return;
        }
        if (!browserSupportsWebGL())
          throw new Error("Browser WebGL unavailable hai. Hardware acceleration/WebGL enable karke reload karein.");
        const WebGLOverlayView = google.maps.WebGLOverlayView;
        if (!WebGLOverlayView)
          throw new Error("This browser/map runtime does not expose WebGLOverlayView.");

        loadedModel = model;
        const center = {
          lat: data.placement.anchor.latitude,
          lng: data.placement.anchor.longitude,
        };
        const map = new google.maps.Map(hostRef.current, {
          center,
          zoom: 19,
          tilt: 67.5,
          heading: data.placement.headingDeg,
          mapId: data.maps.mapId,
          renderingType: google.maps.RenderingType?.VECTOR || "VECTOR",
          tiltInteractionEnabled: true,
          headingInteractionEnabled: true,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });

        const scene = new THREE.Scene();
        const camera = new THREE.Camera();
        root = new THREE.Group();
        root.name = "rekixo-rigid-geo-building";
        applyRigidBuildingPlacement(
          root,
          model,
          data.modelAnchor.localPositionM,
          {
            eastOffsetM: data.placement.eastOffsetM,
            northOffsetM: data.placement.northOffsetM,
            verticalOffsetM: data.placement.verticalOffsetM,
            headingDeg: data.placement.headingDeg,
            pitchDeg: data.placement.pitchDeg,
            rollDeg: data.placement.rollDeg,
            scale: data.placement.scale,
          },
        );
        model.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.frustumCulled = true;
          node.castShadow = false;
          node.receiveShadow = false;
        });
        scene.add(root);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x66717b, 1.35));
        const sun = new THREE.DirectionalLight(0xffffff, 2.0);
        sun.position.set(30, -20, 60);
        scene.add(sun);

        const armContextTimer = () => {
          clearContextTimer();
          if (contextRestored || cancelled) return;
          contextTimer = window.setTimeout(() => {
            if (cancelled || contextRestored) return;
            setFailure(webglTimeoutMessage(map));
            setQuality("Fallback Building view");
            overlay?.setMap(null);
          }, WEBGL_CONTEXT_TIMEOUT_MS);
        };

        overlay = new WebGLOverlayView();
        overlay.onAdd = () => {
          if (cancelled) return;
          setFailure("");
          setQuality("Preparing integrated vector 3D map");
        };
        overlay.onContextRestored = ({ gl }) => {
          if (cancelled) return;
          contextRestored = true;
          clearContextTimer();
          setFailure("");
          renderer = new THREE.WebGLRenderer({
            canvas: gl.canvas as HTMLCanvasElement,
            context: gl,
            ...(gl.getContextAttributes() || {}),
          });
          renderer.autoClear = false;
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 0.95;
          setQuality("Integrated vector terrain + immutable 3D Building");
          overlay?.requestRedraw();
        };
        overlay.onDraw = ({ gl, transformer }) => {
          if (cancelled || !renderer) return;
          const projection = transformer.fromLatLngAltitude({
            lat: data.placement.anchor.latitude,
            lng: data.placement.anchor.longitude,
            altitude: mapAltitude(data),
          });
          camera.projectionMatrix.fromArray(projection);
          renderer.resetState();
          renderer.render(scene, camera);
          renderer.resetState();
          gl.flush();
        };
        overlay.onContextLost = () => {
          contextRestored = false;
          renderer?.dispose();
          renderer = undefined;
          if (!cancelled) {
            setQuality("3D map context restoring");
            armContextTimer();
          }
        };
        overlay.onRemove = () => {
          contextRestored = false;
          clearContextTimer();
          renderer?.dispose();
          renderer = undefined;
        };
        overlay.setMap(map);
        armContextTimer();
        map.moveCamera?.({
          center,
          zoom: 19,
          tilt: 67.5,
          heading: data.placement.headingDeg,
        });
      })
      .catch((reason) => {
        if (cancelled) return;
        clearContextTimer();
        setFailure(
          reason instanceof Error
            ? reason.message
            : "Integrated 3D Geo scene initialize nahi hui.",
        );
        setQuality("Fallback Building view");
      });

    return () => {
      cancelled = true;
      clearContextTimer();
      overlay?.setMap(null);
      renderer?.dispose();
      if (loadedModel) disposeObject(loadedModel);
      if (hostRef.current) hostRef.current.replaceChildren();
    };
  }, [data]);

  return (
    <div className="geo-integrated-scene">
      <div ref={hostRef} className="geo-integrated-map" aria-label={`${data.project.name} integrated 3D geographic scene`} />
      {failure && (
        <div className="geo-integrated-fallback">
          <Viewer3D
            modelUrl={data.model.url}
            modelLabel={data.model.name}
            compactUi
            presentationView="building"
          />
          <div className="geo-fallback-note">
            <strong>Geospatial WebGL fallback</strong>
            <span>{failure}</span>
          </div>
        </div>
      )}
      <div className="geo-quality-badge" role="status">
        <span>GEO RUNTIME</span>
        <strong>{quality}</strong>
      </div>
    </div>
  );
}

export function slugFromGeoPathname(pathname: string) {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 3 || parts[0] !== "3Dprojects" || parts[2] !== "geo")
    return "";
  return parts[1]?.trim().toLowerCase() || "";
}

export default function GeoPublicDemo() {
  const slug = useMemo(() => slugFromGeoPathname(window.location.pathname), []);
  const [data, setData] = useState<GeoPayload>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) {
      setError("3D Geo project slug missing hai.");
      return;
    }
    const controller = new AbortController();
    fetch(`/3Dprojects/api/projects/${encodeURIComponent(slug)}/geo-placement`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as GeoPayload;
        if (!response.ok)
          throw new Error(body.error || `3D Geo load failed (${response.status}).`);
        return body;
      })
      .then((body) => {
        setData(body);
        setError("");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "3D Geo load nahi hua.");
      });
    return () => controller.abort();
  }, [slug]);

  if (error)
    return (
      <main className="jio-public-state">
        <p className="eyebrow">REKIXO AR3D ENGINE</p>
        <h1>3D Geo unavailable</h1>
        <p>{error}</p>
      </main>
    );

  if (!data)
    return (
      <main className="jio-public-state">
        <p className="eyebrow">REKIXO AR3D ENGINE</p>
        <h1>Loading integrated 3D Geo…</h1>
      </main>
    );

  const mapsUrl =
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${data.placement.anchor.latitude.toFixed(7)},${data.placement.anchor.longitude.toFixed(7)}`,
    )}`;
  const mapFallbackReason = !data.maps.apiKey
    ? "Google Maps browser key is not configured"
    : !data.maps.mapId
      ? "Production Google Maps JavaScript Vector Map ID is not configured"
      : "Integrated Google Maps runtime is not configured";

  return (
    <main className="jio-public-shell">
      <header className="jio-public-header">
        <div>
          <p className="eyebrow">INTEGRATED 3D GEO EXPERIENCE</p>
          <h1>{data.project.name}</h1>
          <p>{data.project.location || "Rekixo AR3D Engine"}</p>
        </div>
        <div className="jio-public-header-actions">
          <a href={`/3Dprojects/${encodeURIComponent(data.project.slug)}`}>
            Enter building
          </a>
          <a href={mapsUrl} target="_blank" rel="noreferrer">
            Open location
          </a>
        </div>
      </header>

      <section className="jio-public-meta">
        <article>
          <span>GEO RELEASE</span>
          <strong>v{data.geoRelease.version}</strong>
          <small>{data.geoRelease.manifestFormat || "legacy-compatible"}</small>
        </article>
        <article>
          <span>BUILDING SOURCE</span>
          <strong>v{data.buildingRelease.version}</strong>
          <small>{data.buildingRelease.id}</small>
        </article>
        <article>
          <span>RIGID ALIGNMENT</span>
          <strong>{data.placement.headingDeg.toFixed(1)}° heading</strong>
          <small>WGS84 · ENU · scale {data.placement.scale.toFixed(3)}</small>
        </article>
        <article>
          <span>MODEL ANCHOR</span>
          <strong>{data.modelAnchor.name}</strong>
          <small>{data.modelAnchor.kind} · {data.placement.heightMode}</small>
        </article>
      </section>

      {data.maps.configured && data.maps.apiKey && data.maps.mapId ? (
        <IntegratedGeoScene data={data} />
      ) : (
        <section className="geo-integrated-scene geo-integrated-scene--fallback">
          <Viewer3D
            modelUrl={data.model.url}
            modelLabel={data.model.name}
            compactUi
            presentationView="building"
          />
          <div className="geo-quality-badge">
            <span>GEO FALLBACK</span>
            <strong>{mapFallbackReason}</strong>
          </div>
        </section>
      )}

      <footer className="geo-runtime-note">
        Building geometry remains immutable and rigid. Masterplan calibration, when present,
        applies only to the 2D overlay and never warps the Building model.
      </footer>
    </main>
  );
}
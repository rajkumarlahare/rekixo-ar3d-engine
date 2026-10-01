import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoMapsSettings,
  geoPlacement,
  projects,
  removeGeoPlacement,
  saveGeoMapsKey,
  saveGeoPlacement,
  session,
  type CloudGeoPlacementState,
  type CloudProjectSummary,
} from "../studio/cloud";
import GeoModelPreview, { type GeoPreviewPlacement } from "./GeoModelPreview";
import "./geo-mapper.css";

type IntegrationModel = {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  byteSize?: number;
  available?: boolean;
  url?: string;
  sha256?: string;
};

type IntegrationPayload = {
  contractVersion?: number;
  project?: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  model?: IntegrationModel;
  geoModel?: IntegrationModel & {
    variant?: "geo-optimized";
    sourceModelId?: string;
  };
  release?: {
    id: string;
    version: number;
    createdAt?: string;
  };
  error?: string;
};

type FormState = {
  longitude: string;
  latitude: string;
  altitudeM: string;
  headingDeg: string;
  pitchDeg: string;
  rollDeg: string;
  scale: string;
  publicEnabled: boolean;
};

type LatLngLike = { lat(): number; lng(): number };
type MapMouseEvent = { latLng?: LatLngLike | null };
type GoogleMap = {
  addListener(name: string, listener: (event: MapMouseEvent) => void): { remove(): void };
  setCenter(position: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
};
type GoogleMarker = {
  setMap(map: GoogleMap | null): void;
  setPosition(position: { lat: number; lng: number }): void;
  addListener(name: string, listener: () => void): { remove(): void };
  getPosition(): LatLngLike | null;
};
type GoogleRoot = {
  maps: {
    Map: new (node: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
  };
};

type GeoWindow = Window &
  typeof globalThis & {
    google?: GoogleRoot;
    __rekixoEngineGeoMapsReady?: () => void;
  };

let mapsPromise: Promise<GoogleRoot> | null = null;
let mapsKeyLoaded = "";

function requestedProjectSlug() {
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function numberOr(value: string, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validCoordinates(form: FormState) {
  const longitude = Number(form.longitude);
  const latitude = Number(form.latitude);
  return (
    form.longitude.trim() !== "" &&
    form.latitude.trim() !== "" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function loadGoogleMaps(apiKey: string) {
  const geoWindow = window as GeoWindow;
  if (geoWindow.google?.maps?.Map && mapsKeyLoaded === apiKey)
    return Promise.resolve(geoWindow.google);
  if (mapsPromise && mapsKeyLoaded === apiKey) return mapsPromise;

  mapsKeyLoaded = apiKey;
  mapsPromise = new Promise<GoogleRoot>((resolve, reject) => {
    const callback = "__rekixoEngineGeoMapsReady";
    geoWindow[callback] = () => {
      if (geoWindow.google?.maps?.Map) resolve(geoWindow.google);
      else reject(new Error("Google Maps JavaScript API load nahi hui."));
    };
    const existing = document.getElementById("rekixo-engine-geo-maps-js");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "rekixo-engine-geo-maps-js";
    script.async = true;
    script.defer = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error("Google Satellite map load nahi hua."));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

async function integration(slug: string) {
  const response = await fetch(
    `/3Dprojects/api/integration/projects/${encodeURIComponent(slug)}`,
    { cache: "no-store", headers: { Accept: "application/json" } },
  );
  const body = (await response.json()) as IntegrationPayload;
  if (!response.ok)
    throw new Error(body.error || `Engine integration load failed (${response.status}).`);
  return body;
}

function formFromState(state: CloudGeoPlacementState): FormState {
  const placement = state.placement;
  if (!placement)
    return {
      longitude: "",
      latitude: "",
      altitudeM: "0",
      headingDeg: "0",
      pitchDeg: "0",
      rollDeg: "0",
      scale: "1",
      publicEnabled: false,
    };
  return {
    longitude: String(placement.longitude),
    latitude: String(placement.latitude),
    altitudeM: String(placement.altitudeM),
    headingDeg: String(placement.headingDeg),
    pitchDeg: String(placement.pitchDeg),
    rollDeg: String(placement.rollDeg),
    scale: String(placement.scale),
    publicEnabled: placement.publicEnabled,
  };
}

export default function GeoMapper3D() {
  const [projectList, setProjectList] = useState<CloudProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [state, setState] = useState<CloudGeoPlacementState>();
  const [engine, setEngine] = useState<IntegrationPayload>();
  const [form, setForm] = useState<FormState>({
    longitude: "",
    latitude: "",
    altitudeM: "0",
    headingDeg: "0",
    pitchDeg: "0",
    rollDeg: "0",
    scale: "1",
    publicEnabled: false,
  });
  const [busy, setBusy] = useState(false);
  const [mapsKeyInput, setMapsKeyInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    let live = true;
    void session()
      .then((cloudSession) => {
        if (!cloudSession.authenticated) {
          window.location.replace(
            `/3Dprojects/login?return=${encodeURIComponent(
              window.location.pathname + window.location.search,
            )}`,
          );
          return null;
        }
        return Promise.all([
          projects("", "active", 100, 0),
          geoMapsSettings().catch(() => ({ apiKey: null })),
        ]);
      })
      .then((payload) => {
        if (!live || !payload) return;
        const [projectsPayload, mapsPayload] = payload;
        setProjectList(projectsPayload.projects);
        if (mapsPayload.apiKey) setMapsKeyInput(mapsPayload.apiKey);
        const requested = requestedProjectSlug();
        const first =
          projectsPayload.projects.find((item) => item.slug === requested)?.slug ||
          projectsPayload.projects[0]?.slug ||
          "";
        setSelectedSlug(first);
      })
      .catch((reason) => {
        if (live)
          setError(reason instanceof Error ? reason.message : "3D projects load nahi hue.");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    let live = true;
    setBusy(true);
    setError("");
    setMessage("");
    Promise.all([geoPlacement(selectedSlug), integration(selectedSlug)])
      .then(([placementState, integrationState]) => {
        if (!live) return;
        setState(placementState);
        setEngine(integrationState);
        setForm(formFromState(placementState));
      })
      .catch((reason) => {
        if (live)
          setError(reason instanceof Error ? reason.message : "3D Jio Mapper load nahi hua.");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    const url = new URL(window.location.href);
    url.searchParams.set("project", selectedSlug);
    window.history.replaceState({}, "", url);
    return () => {
      live = false;
    };
  }, [selectedSlug]);

  const renderModel = useMemo(() => {
    const source = engine?.model;
    const geo = engine?.geoModel;
    if (
      geo?.available !== false &&
      geo?.mimeType === "model/gltf-binary" &&
      geo.url &&
      source &&
      geo.sourceModelId === source.id
    )
      return geo;
    if (source?.available !== false && source?.mimeType === "model/gltf-binary" && source.url)
      return source;
    return null;
  }, [engine]);

  const modelUrl = useMemo(() => {
    if (!renderModel?.url) return null;
    try {
      return new URL(renderModel.url, window.location.origin).toString();
    } catch {
      return null;
    }
  }, [renderModel]);

  const numericPlacement: GeoPreviewPlacement = {
    altitudeM: numberOr(form.altitudeM, 0),
    headingDeg: numberOr(form.headingDeg, 0),
    pitchDeg: numberOr(form.pitchDeg, 0),
    rollDeg: numberOr(form.rollDeg, 0),
    scale: Math.max(0.001, numberOr(form.scale, 1)),
  };

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setCoordinates(longitude: number, latitude: number) {
    setForm((current) => ({
      ...current,
      longitude: longitude.toFixed(7),
      latitude: latitude.toFixed(7),
    }));
  }

  useEffect(() => {
    if (!state?.mapsApiKey || !mapHostRef.current) return;
    let cancelled = false;
    let mapClick: { remove(): void } | null = null;
    let markerDrag: { remove(): void } | null = null;

    void loadGoogleMaps(state.mapsApiKey)
      .then((google) => {
        if (cancelled || !mapHostRef.current) return;
        const hasCoords = validCoordinates(formRef.current);
        const center = hasCoords
          ? {
              lat: Number(formRef.current.latitude),
              lng: Number(formRef.current.longitude),
            }
          : { lat: 20.5937, lng: 78.9629 };
        const map = new google.maps.Map(mapHostRef.current, {
          center,
          zoom: hasCoords ? 19 : 5,
          mapTypeId: "hybrid",
          streetViewControl: false,
          mapTypeControl: true,
          fullscreenControl: true,
          gestureHandling: "greedy",
          tilt: 0,
          heading: 0,
        });
        const marker = new google.maps.Marker({
          map,
          position: center,
          draggable: true,
          title: "3D building anchor",
        });
        mapRef.current = map;
        markerRef.current = marker;
        mapClick = map.addListener("click", (event) => {
          if (!event.latLng) return;
          const next = { lat: event.latLng.lat(), lng: event.latLng.lng() };
          marker.setPosition(next);
          setCoordinates(next.lng, next.lat);
        });
        markerDrag = marker.addListener("dragend", () => {
          const next = marker.getPosition();
          if (next) setCoordinates(next.lng(), next.lat());
        });
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Google Satellite map load nahi hua.");
      });

    return () => {
      cancelled = true;
      mapClick?.remove();
      markerDrag?.remove();
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
      mapHostRef.current?.replaceChildren();
    };
  }, [state?.mapsApiKey, selectedSlug]);

  useEffect(() => {
    if (!validCoordinates(form)) return;
    const position = {
      lat: Number(form.latitude),
      lng: Number(form.longitude),
    };
    markerRef.current?.setPosition(position);
  }, [form.longitude, form.latitude]);

  async function saveMapsKey() {
    const clean = mapsKeyInput.trim();
    if (!clean) {
      setError("Google Maps browser key enter karein.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveGeoMapsKey(clean);
      if (selectedSlug) {
        const next = await geoPlacement(selectedSlug);
        setState(next);
      }
      setMessage("Google Maps browser key Engine me saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Maps key save nahi hui.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!selectedSlug || !validCoordinates(form)) {
      setError("Valid longitude/latitude set karein.");
      return;
    }
    if (!renderModel || !engine?.release) {
      setError("Published GLB + active immutable release required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await saveGeoPlacement(selectedSlug, {
        longitude: Number(form.longitude),
        latitude: Number(form.latitude),
        altitudeM: numberOr(form.altitudeM, 0),
        headingDeg: numberOr(form.headingDeg, 0),
        pitchDeg: numberOr(form.pitchDeg, 0),
        rollDeg: numberOr(form.rollDeg, 0),
        scale: Math.max(0.001, numberOr(form.scale, 1)),
        publicEnabled: form.publicEnabled,
      });
      setState(next);
      setForm(formFromState(next));
      setMessage(`Placement saved · release v${next.placement?.releaseVersion ?? engine.release.version} pinned`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Placement save nahi hui.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selectedSlug || !state?.placement) return;
    if (!window.confirm("Sirf 3D Jio placement remove karein? Model/release delete nahi honge.")) return;
    setBusy(true);
    setError("");
    try {
      const next = await removeGeoPlacement(selectedSlug);
      setState(next);
      setForm(formFromState(next));
      setMessage("3D Jio placement removed; Engine model/release safe hai.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Placement remove nahi hui.");
    } finally {
      setBusy(false);
    }
  }

  function resetAlignment() {
    setForm((current) => ({
      ...current,
      altitudeM: "0",
      headingDeg: "0",
      pitchDeg: "0",
      rollDeg: "0",
      scale: "1",
    }));
  }

  const mapsLink = validCoordinates(form)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${Number(form.latitude).toFixed(7)},${Number(form.longitude).toFixed(7)}`,
      )}`
    : null;

  return (
    <main className="geo3d-shell">
      <header className="geo3d-topbar">
        <div>
          <p className="eyebrow">REKIXO AR3D ENGINE</p>
          <h1>3D Jio Mapper</h1>
          <p>Building placement Engine ke andar rakhein; Platform Geo Mapper masterplan-only rahega.</p>
        </div>
        <div className="geo3d-actions">
          <a href="/3Dprojects">Engine Home</a>
          <a href="/3Dprojects/studio">Design Studio</a>
          <select
            value={selectedSlug}
            onChange={(event) => setSelectedSlug(event.target.value)}
            disabled={busy || !projectList.length}
            aria-label="Select Engine project"
          >
            {!projectList.length ? <option value="">No project</option> : null}
            {projectList.map((project) => (
              <option key={project.id} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error ? <section className="geo3d-alert geo3d-alert--error">{error}</section> : null}
      {message ? <section className="geo3d-alert geo3d-alert--ok">{message}</section> : null}

      <section className="geo3d-health">
        <article>
          <span>PROJECT</span>
          <strong>{state?.project.name || engine?.project?.name || "—"}</strong>
          <small>{selectedSlug || "Select project"}</small>
        </article>
        <article>
          <span>ACTIVE RELEASE</span>
          <strong>{engine?.release ? `v${engine.release.version}` : "Required"}</strong>
          <small>{engine?.release?.id || "Publish release first"}</small>
        </article>
        <article>
          <span>GEO MODEL</span>
          <strong>{renderModel?.name || "Published GLB required"}</strong>
          <small>
            {renderModel?.byteSize
              ? `${(renderModel.byteSize / 1_000_000).toFixed(2)} MB`
              : renderModel?.mimeType || "—"}
          </small>
        </article>
        <article>
          <span>PLACEMENT</span>
          <strong>{state?.placement ? "Saved" : "Draft"}</strong>
          <small>
            {state?.placement
              ? `Pinned release v${state.placement.releaseVersion}`
              : "No Engine Geo placement yet"}
          </small>
        </article>
      </section>

      {!state?.schemaReady ? (
        <section className="geo3d-alert geo3d-alert--error">
          3D Jio Mapper database migration pending hai. Existing Engine projects safe hain; migration apply hone ke baad Save active hoga.
        </section>
      ) : null}

      {state?.placementStale ? (
        <section className="geo3d-alert geo3d-alert--error">
          Active Engine release badal chuka hai. Purana Jio placement public nahi maana jayega; current release ke saath preview verify karke Save karein.
        </section>
      ) : null}

      <section className="geo3d-workspace">
        <div className="geo3d-map-card">
          <div className="geo3d-section-head">
            <div>
              <p className="eyebrow">GEO ANCHOR</p>
              <h3>Satellite placement</h3>
            </div>
            {mapsLink ? (
              <a href={mapsLink} target="_blank" rel="noreferrer">
                Open in Google Maps
              </a>
            ) : null}
          </div>
          {state?.mapsConfigured ? (
            <>
              <div ref={mapHostRef} className="geo3d-map" aria-label="3D building satellite anchor map" />
              <p className="geo3d-help">
                Map par click karein ya red anchor ko drag karein. Is map par GLB overlay nahi hota,
                isliye camera jitter building placement ko move nahi kar sakta.
              </p>
            </>
          ) : (
            <div className="geo3d-map-placeholder">
              <strong>Google Maps browser key Engine me configure karein.</strong>
              <span>Browser-restricted key use karein; ye client-side Maps API ke liye public configuration hoti hai.</span>
              <div className="geo3d-key-row">
                <input
                  value={mapsKeyInput}
                  onChange={(event) => setMapsKeyInput(event.target.value)}
                  placeholder="AIza…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" onClick={() => void saveMapsKey()} disabled={busy}>
                  Save Maps key
                </button>
              </div>
            </div>
          )}
        </div>

        <GeoModelPreview modelUrl={modelUrl} placement={numericPlacement} />
      </section>

      <section className="geo3d-form-card">
        <div className="geo3d-section-head">
          <div>
            <p className="eyebrow">PLACEMENT VALUES</p>
            <h3>Geo + model alignment</h3>
          </div>
          <button type="button" onClick={resetAlignment} disabled={busy}>Reset alignment</button>
        </div>

        <div className="geo3d-form-grid">
          <label>
            <span>Longitude</span>
            <input value={form.longitude} onChange={(e) => patch("longitude", e.target.value)} placeholder="82.9500214" />
          </label>
          <label>
            <span>Latitude</span>
            <input value={form.latitude} onChange={(e) => patch("latitude", e.target.value)} placeholder="21.9617594" />
          </label>
          <label>
            <span>Ground offset (m)</span>
            <input type="number" step="0.1" value={form.altitudeM} onChange={(e) => patch("altitudeM", e.target.value)} />
          </label>
          <label>
            <span>Heading (°)</span>
            <input type="number" step="1" value={form.headingDeg} onChange={(e) => patch("headingDeg", e.target.value)} />
          </label>
          <label>
            <span>Scale</span>
            <input type="number" step="0.01" min="0.001" value={form.scale} onChange={(e) => patch("scale", e.target.value)} />
          </label>
          <label>
            <span>Pitch (°)</span>
            <input type="number" step="1" value={form.pitchDeg} onChange={(e) => patch("pitchDeg", e.target.value)} />
          </label>
          <label>
            <span>Roll (°)</span>
            <input type="number" step="1" value={form.rollDeg} onChange={(e) => patch("rollDeg", e.target.value)} />
          </label>
          <label className="geo3d-toggle">
            <input
              type="checkbox"
              checked={form.publicEnabled}
              onChange={(e) => patch("publicEnabled", e.target.checked)}
            />
            <span>Public 3D Jio demo</span>
            <small>Engine public Jio route ko enable karta hai; Platform Geo Mapper ko touch nahi karta.</small>
          </label>
        </div>

        <div className="geo3d-save-row">
          <button
            className="geo3d-primary"
            type="button"
            onClick={() => void save()}
            disabled={busy || !state?.schemaReady || !renderModel || !engine?.release}
          >
            {busy ? "Saving…" : "Save 3D Jio placement"}
          </button>
          {state?.placement ? (
            <button type="button" onClick={() => void remove()} disabled={busy}>
              Remove placement
            </button>
          ) : null}

          {state?.placement?.publicEnabled && !state?.placementStale ? (
            <a
              className="geo3d-public-link"
              href={`https://ar3dstudio.in/3Dprojects/${encodeURIComponent(selectedSlug)}/geo`}
              target="_blank"
              rel="noreferrer"
            >
              Open public Jio demo
            </a>
          ) : null}
          <span>
            Model/release bytes immutable rahenge. Save sirf Engine Geo placement record update karta hai.
          </span>
        </div>
      </section>
    </main>
  );
}

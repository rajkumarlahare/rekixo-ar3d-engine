import { useEffect, useMemo, useRef, useState } from "react";
import {
  activateGeoRelease,
  geoDraft,
  geoMapsSettings,
  geoReleases,
  projects,
  publishGeoRelease,
  releases,
  resetGeoDraft,
  saveGeoDraft,
  saveGeoMapsKey,
  session,
  verifyGeoPreview,
  type CloudGeoDraftState,
  type CloudGeoReleaseState,
  type CloudProjectSummary,
  type CloudReleaseSummary,
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
  return (
    new URLSearchParams(window.location.search)
      .get("project")
      ?.trim()
      .toLowerCase() || ""
  );
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
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        apiKey,
      )}&v=weekly&loading=async&callback=${callback}`;
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
    throw new Error(
      body.error || `Engine integration load failed (${response.status}).`,
    );
  return body;
}

function emptyForm(): FormState {
  return {
    longitude: "",
    latitude: "",
    altitudeM: "0",
    headingDeg: "0",
    pitchDeg: "0",
    rollDeg: "0",
    scale: "1",
  };
}

function formFromState(state: CloudGeoDraftState): FormState {
  const draft = state.draft;
  if (!draft) return emptyForm();
  return {
    longitude: draft.longitude === null ? "" : String(draft.longitude),
    latitude: draft.latitude === null ? "" : String(draft.latitude),
    altitudeM: String(draft.altitudeM),
    headingDeg: String(draft.headingDeg),
    pitchDeg: String(draft.pitchDeg),
    rollDeg: String(draft.rollDeg),
    scale: String(draft.scale),
  };
}

export default function GeoMapper3D() {
  const [projectList, setProjectList] = useState<CloudProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [state, setState] = useState<CloudGeoDraftState>();
  const [geoReleaseState, setGeoReleaseState] = useState<CloudGeoReleaseState>();
  const [releaseItems, setReleaseItems] = useState<CloudReleaseSummary[]>([]);
  const [sourceReleaseId, setSourceReleaseId] = useState("");
  const [engine, setEngine] = useState<IntegrationPayload>();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [draftDirty, setDraftDirty] = useState(false);
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
          setError(
            reason instanceof Error
              ? reason.message
              : "3D projects load nahi hue.",
          );
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
    setState(undefined);
    setGeoReleaseState(undefined);
    setEngine(undefined);
    setReleaseItems([]);
    setSourceReleaseId("");
    setForm(emptyForm());

    Promise.all([
      geoDraft(selectedSlug),
      integration(selectedSlug),
      releases(selectedSlug),
      geoReleases(selectedSlug),
    ])
      .then(([draftState, integrationState, releaseState, geoReleaseResult]) => {
        if (!live) return;
        setState(draftState);
        setGeoReleaseState(geoReleaseResult);
        setEngine(integrationState);
        setReleaseItems(releaseState.releases);
        setSourceReleaseId(
          draftState.draft?.sourceBuildingReleaseId ||
            draftState.sourceRelease?.id ||
            "",
        );
        setForm(formFromState(draftState));
        setDraftDirty(false);
      })
      .catch((reason) => {
        if (live)
          setError(
            reason instanceof Error
              ? reason.message
              : "3D Geo Mapper load nahi hua.",
          );
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

  const selectedSource = useMemo(
    () => releaseItems.find((release) => release.id === sourceReleaseId),
    [releaseItems, sourceReleaseId],
  );

  const sourcePreviewAvailable = Boolean(
    sourceReleaseId &&
      engine?.release?.id &&
      sourceReleaseId === engine.release.id,
  );

  const renderModel = useMemo(() => {
    if (!sourcePreviewAvailable) return null;
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
    if (
      source?.available !== false &&
      source?.mimeType === "model/gltf-binary" &&
      source.url
    )
      return source;
    return null;
  }, [engine, sourcePreviewAvailable]);

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
    setDraftDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setCoordinates(longitude: number, latitude: number) {
    setDraftDirty(true);
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
          setError(
            reason instanceof Error
              ? reason.message
              : "Google Satellite map load nahi hua.",
          );
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
        const next = await geoDraft(selectedSlug);
        setState(next);
      }
      setMessage("Google Maps browser key Engine me saved.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Maps key save nahi hui.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!selectedSlug || !state?.draft || !validCoordinates(form)) {
      setError("Valid Geo draft aur longitude/latitude required hai.");
      return;
    }
    if (!sourceReleaseId || !selectedSource) {
      setError("Source Building release select karein.");
      return;
    }
    if (!sourcePreviewAvailable || !renderModel || !engine?.release) {
      setError(
        `Selected Building release preview available nahi hai. Current active Building v${engine?.release?.version ?? "—"} select karke upgrade preview verify karein.`,
      );
      return;
    }

    setBusy(true);
    setError("");
    try {
      const next = await saveGeoDraft(selectedSlug, {
        expectedRevision: state.draft.revision,
        sourceBuildingReleaseId: sourceReleaseId,
        longitude: Number(form.longitude),
        latitude: Number(form.latitude),
        altitudeM: numberOr(form.altitudeM, 0),
        headingDeg: numberOr(form.headingDeg, 0),
        pitchDeg: numberOr(form.pitchDeg, 0),
        rollDeg: numberOr(form.rollDeg, 0),
        scale: Math.max(0.001, numberOr(form.scale, 1)),
      });
      setState(next);
      setSourceReleaseId(next.draft?.sourceBuildingReleaseId || sourceReleaseId);
      setForm(formFromState(next));
      setDraftDirty(false);
      setGeoReleaseState(await geoReleases(selectedSlug));
      setMessage(
        `Geo draft saved · Building v${next.draft?.sourceBuildingReleaseVersion ?? selectedSource.version} pinned. Existing live Geo unchanged hai.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Geo draft save nahi hua.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetDraft() {
    if (!selectedSlug || !state?.draft) return;
    if (
      !window.confirm(
        "Geo draft alignment reset karein? Existing live Geo snapshot change nahi hoga.",
      )
    )
      return;

    setBusy(true);
    setError("");
    try {
      const next = await resetGeoDraft(selectedSlug, state.draft.revision);
      setState(next);
      setSourceReleaseId(next.draft?.sourceBuildingReleaseId || sourceReleaseId);
      setForm(formFromState(next));
      setDraftDirty(false);
      setGeoReleaseState(await geoReleases(selectedSlug));
      setMessage("Geo draft reset hua. Existing live Geo snapshot safe hai.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Geo draft reset nahi hua.",
      );
    } finally {
      setBusy(false);
    }
  }

  function resetAlignment() {
    setDraftDirty(true);
    setForm((current) => ({
      ...current,
      altitudeM: "0",
      headingDeg: "0",
      pitchDeg: "0",
      rollDeg: "0",
      scale: "1",
    }));
  }

  async function verifyPreview() {
    if (!selectedSlug || !state?.draft) return;
    if (draftDirty) {
      setError("Preview verify karne se pehle current Geo changes Save karein.");
      return;
    }
    if (!sourcePreviewAvailable || !renderModel || !validCoordinates(form)) {
      setError("Current active Building source ke saath valid Geo preview required hai.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await verifyGeoPreview(selectedSlug, state.draft.revision);
      const next = await geoReleases(selectedSlug);
      setGeoReleaseState(next);
      setMessage(
        `Geo preview verified · draft revision ${state.draft.revision}. Ab immutable Geo release publish ki ja sakti hai.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Geo preview verify nahi hua.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function publishGeo() {
    if (!selectedSlug || !state?.draft) return;
    if (draftDirty) {
      setError("Geo release publish karne se pehle current changes Save karein.");
      return;
    }
    if (!geoReleaseState?.previewVerified) {
      setError("Current Geo preview verify karna required hai.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await publishGeoRelease(
        selectedSlug,
        state.draft.revision,
      );
      const next = await geoReleases(selectedSlug);
      setGeoReleaseState(next);
      setMessage(
        `Immutable Geo Release v${result.release.version} published and activated. Building Website unchanged hai.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Geo release publish nahi hui.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function activateGeoVersion(releaseId: string, version: number) {
    if (!selectedSlug) return;
    if (
      !window.confirm(
        `Geo Release v${version} activate karein? Building Website aur Geo draft change nahi honge.`,
      )
    )
      return;

    setBusy(true);
    setError("");
    try {
      await activateGeoRelease(selectedSlug, releaseId);
      const next = await geoReleases(selectedSlug);
      setGeoReleaseState(next);
      setMessage(`Geo Release v${version} active ho gayi. Rollback pointer safely update hua.`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Geo release activate nahi hui.",
      );
    } finally {
      setBusy(false);
    }
  }

  const mapsLink = validCoordinates(form)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${Number(form.latitude).toFixed(7)},${Number(form.longitude).toFixed(7)}`,
      )}`
    : null;

  const geoLive = Boolean(geoReleaseState?.activeRelease);

  return (
    <main className="geo3d-shell">
      <header className="geo3d-topbar">
        <div>
          <p className="eyebrow">REKIXO AR3D ENGINE</p>
          <h1>3D Geo Mapper</h1>
          <p>
            Optional Geo Experience ka source Building release, real location aur
            alignment yahan draft me prepare karein.
          </p>
        </div>
        <div className="geo3d-actions">
          <a href="/3Dprojects">Engine Home</a>
          <a
            href={
              selectedSlug
                ? `/3Dprojects/studio?project=${encodeURIComponent(selectedSlug)}`
                : "/3Dprojects/studio"
            }
          >
            Edit Building in Studio
          </a>
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

      {error ? (
        <section className="geo3d-alert geo3d-alert--error">{error}</section>
      ) : null}
      {message ? (
        <section className="geo3d-alert geo3d-alert--ok">{message}</section>
      ) : null}

      <section className="geo3d-health">
        <article>
          <span>PROJECT</span>
          <strong>{state?.project.name || engine?.project?.name || "—"}</strong>
          <small>{selectedSlug || "Select project"}</small>
        </article>
        <article>
          <span>DRAFT SOURCE</span>
          <strong>
            {selectedSource
              ? `Building v${selectedSource.version}`
              : state?.draft
                ? `Building v${state.draft.sourceBuildingReleaseVersion}`
                : "Required"}
          </strong>
          <small>{sourceReleaseId || "Geo Experience source not selected"}</small>
        </article>
        <article>
          <span>GEO MODEL PREVIEW</span>
          <strong>{renderModel?.name || "Preview unavailable"}</strong>
          <small>
            {renderModel?.byteSize
              ? `${(renderModel.byteSize / 1_000_000).toFixed(2)} MB`
              : sourcePreviewAvailable
                ? renderModel?.mimeType || "Published GLB required"
                : "Select current active Building release to preview"}
          </small>
        </article>
        <article>
          <span>GEO DRAFT</span>
          <strong>
            {state?.draft ? `Revision ${state.draft.revision}` : "Not ready"}
          </strong>
          <small>
            {state?.draft && state.draft.longitude !== null
              ? "Location + alignment saved in editable draft"
              : "Choose source, location and alignment"}
          </small>
        </article>
      </section>

      {!state?.schemaReady && state ? (
        <section className="geo3d-alert geo3d-alert--error">
          Geo draft database migration pending hai. Existing Building aur live Geo
          data safe hai.
        </section>
      ) : null}

      {state?.sourceUpdateAvailable ? (
        <section className="geo3d-alert geo3d-alert--warn">
          New Building release v{state.activeBuildingRelease?.version} available hai.
          Geo draft abhi Building v{state.draft?.sourceBuildingReleaseVersion} par
          pinned hai. Upgrade automatic nahi hoga; source select karke preview verify
          karne ke baad hi draft save karein.
        </section>
      ) : null}

      {sourceReleaseId && !sourcePreviewAvailable && engine?.release ? (
        <section className="geo3d-alert geo3d-alert--warn">
          Selected source Building v{selectedSource?.version ?? "—"} current active
          Building v{engine.release.version} se alag hai. Existing pinned source safe
          hai; model preview ke liye current active release select karein.
        </section>
      ) : null}

      {geoReleaseState?.activeRelease ? (
        <section className="geo3d-alert geo3d-alert--info">
          Current Geo website immutable Geo v
          {geoReleaseState.activeRelease.version} se serve ho rahi hai, jo Building v
          {geoReleaseState.activeRelease.sourceBuildingReleaseVersion} par pinned hai.
          Draft save karne se live Geo website change nahi hoti; sirf Publish ya
          Activate / Rollback live pointer badalta hai.
        </section>
      ) : null}

      <section className="geo3d-form-card geo3d-source-card">
        <div className="geo3d-section-head">
          <div>
            <p className="eyebrow">01 · SOURCE</p>
            <h3>Immutable Building release</h3>
          </div>
          <span className="geo3d-draft-badge">DRAFT ONLY</span>
        </div>

        <div className="geo3d-source-grid">
          <label>
            <span>Source Building release</span>
            <select
              value={sourceReleaseId}
              onChange={(event) => {
                setSourceReleaseId(event.target.value);
                setDraftDirty(true);
                setMessage("");
                setError("");
              }}
              disabled={busy || !releaseItems.length}
              aria-label="Geo source Building release"
            >
              {!releaseItems.length ? (
                <option value="">Publish Building first</option>
              ) : null}
              {releaseItems.map((release) => (
                <option key={release.id} value={release.id}>
                  v{release.version}
                  {release.active ? " · ACTIVE BUILDING" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="geo3d-source-note">
            <strong>
              {selectedSource
                ? `Building Release v${selectedSource.version}`
                : "Select immutable Building release"}
            </strong>
            <span>
              Source change sirf Geo draft me pin hota hai. Building Website aur
              existing Geo live snapshot automatically switch nahi honge.
            </span>
          </div>
        </div>
      </section>

      <section className="geo3d-workspace">
        <div className="geo3d-map-card">
          <div className="geo3d-section-head">
            <div>
              <p className="eyebrow">02 · LOCATION</p>
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
              <div
                ref={mapHostRef}
                className="geo3d-map"
                aria-label="3D building satellite anchor map"
              />
              <p className="geo3d-help">
                Map par click karein ya red anchor drag karein. Map anchor aur 3D
                preview alag controls hain, isliye camera movement saved location ko
                move nahi karta.
              </p>
            </>
          ) : (
            <div className="geo3d-map-placeholder">
              <strong>Google Maps browser key Engine me configure karein.</strong>
              <span>
                Browser-restricted key use karein; ye client-side Maps API ke liye
                public configuration hoti hai.
              </span>
              <div className="geo3d-key-row">
                <input
                  value={mapsKeyInput}
                  onChange={(event) => setMapsKeyInput(event.target.value)}
                  placeholder="AIza…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => void saveMapsKey()}
                  disabled={busy}
                >
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
            <p className="eyebrow">03 · ALIGNMENT</p>
            <h3>Geo + model alignment</h3>
          </div>
          <button type="button" onClick={resetAlignment} disabled={busy}>
            Reset alignment values
          </button>
        </div>

        <div className="geo3d-form-grid">
          <label>
            <span>Longitude</span>
            <input
              value={form.longitude}
              onChange={(event) => patch("longitude", event.target.value)}
              placeholder="82.9500214"
            />
          </label>
          <label>
            <span>Latitude</span>
            <input
              value={form.latitude}
              onChange={(event) => patch("latitude", event.target.value)}
              placeholder="21.9617594"
            />
          </label>
          <label>
            <span>Ground offset (m)</span>
            <input
              type="number"
              step="0.1"
              value={form.altitudeM}
              onChange={(event) => patch("altitudeM", event.target.value)}
            />
          </label>
          <label>
            <span>Heading (°)</span>
            <input
              type="number"
              step="1"
              value={form.headingDeg}
              onChange={(event) => patch("headingDeg", event.target.value)}
            />
          </label>
          <label>
            <span>Scale</span>
            <input
              type="number"
              step="0.01"
              min="0.001"
              value={form.scale}
              onChange={(event) => patch("scale", event.target.value)}
            />
          </label>
          <label>
            <span>Pitch (°)</span>
            <input
              type="number"
              step="1"
              value={form.pitchDeg}
              onChange={(event) => patch("pitchDeg", event.target.value)}
            />
          </label>
          <label>
            <span>Roll (°)</span>
            <input
              type="number"
              step="1"
              value={form.rollDeg}
              onChange={(event) => patch("rollDeg", event.target.value)}
            />
          </label>
        </div>

        <div className="geo3d-save-row">
          <button
            className="geo3d-primary"
            type="button"
            onClick={() => void save()}
            disabled={
              busy ||
              !state?.schemaReady ||
              !state?.draft ||
              !sourceReleaseId ||
              !sourcePreviewAvailable ||
              !renderModel
            }
          >
            {busy ? "Saving…" : "Save Geo draft"}
          </button>

          {state?.draft && state.draft.longitude !== null ? (
            <button
              type="button"
              onClick={() => void resetDraft()}
              disabled={busy}
            >
              Reset Geo draft
            </button>
          ) : null}

          {geoLive ? (
            <a
              className="geo3d-public-link"
              href={`https://ar3dstudio.in/3Dprojects/${encodeURIComponent(
                selectedSlug,
              )}/geo`}
              target="_blank"
              rel="noreferrer"
            >
              Open Geo Live
            </a>
          ) : null}

          <span>
            Save editable Geo draft ko update karta hai. Active immutable Geo Release
            aur Building release bytes change nahi hote.
          </span>
        </div>
      </section>

      <section className="geo3d-form-card geo3d-release-card">
        <div className="geo3d-section-head">
          <div>
            <p className="eyebrow">04 · RELEASE</p>
            <h3>Verify → Publish → Activate / Rollback</h3>
          </div>
          <span className="geo3d-draft-badge">
            {geoReleaseState?.activeRelease
              ? `ACTIVE GEO v${geoReleaseState.activeRelease.version}`
              : "NO GEO RELEASE"}
          </span>
        </div>

        <div className="geo3d-release-readiness">
          <article>
            <span>SAVED DRAFT</span>
            <strong>{state?.draft ? `r${state.draft.revision}` : "—"}</strong>
            <small>{draftDirty ? "Unsaved changes present" : "Saved state"}</small>
          </article>
          <article>
            <span>PREVIEW CHECK</span>
            <strong>
              {geoReleaseState?.previewVerified ? "Verified" : "Required"}
            </strong>
            <small>
              {geoReleaseState?.previewVerification
                ? `Building v${geoReleaseState.previewVerification.sourceBuildingReleaseVersion}`
                : "Verify current saved preview"}
            </small>
          </article>
          <article>
            <span>ACTIVE IMMUTABLE GEO</span>
            <strong>
              {geoReleaseState?.activeRelease
                ? `v${geoReleaseState.activeRelease.version}`
                : "None"}
            </strong>
            <small>
              {geoReleaseState?.activeRelease
                ? `Building v${geoReleaseState.activeRelease.sourceBuildingReleaseVersion}`
                : "Publish verified draft"}
            </small>
          </article>
        </div>

        <div className="geo3d-save-row">
          <button
            type="button"
            onClick={() => void verifyPreview()}
            disabled={
              busy ||
              !state?.draft ||
              draftDirty ||
              !sourcePreviewAvailable ||
              !renderModel ||
              !validCoordinates(form)
            }
          >
            {geoReleaseState?.previewVerified
              ? "Preview verified"
              : "Verify current preview"}
          </button>
          <button
            className="geo3d-primary"
            type="button"
            onClick={() => void publishGeo()}
            disabled={
              busy ||
              draftDirty ||
              !state?.draft ||
              !geoReleaseState?.previewVerified
            }
          >
            Publish Geo Release
          </button>
          <span>
            Publish verified draft se naya immutable Geo Release banta hai aur wahi
            customer Geo website ka active source hota hai. Building Website independently
            apne Building release par rehti hai.
          </span>
        </div>

        <div className="geo3d-release-history">
          <div className="geo3d-release-history__title">
            <strong>Geo Release History</strong>
            <span>{geoReleaseState?.releases.length ?? 0} immutable release(s)</span>
          </div>
          {geoReleaseState?.releases.length ? (
            geoReleaseState.releases.map((release) => (
              <article key={release.id}>
                <div>
                  <strong>Geo v{release.version}</strong>
                  <span>
                    Building v{release.sourceBuildingReleaseVersion} · draft r
                    {release.sourceDraftRevision}
                  </span>
                  <small>{release.createdAt}</small>
                </div>
                {release.active ? (
                  <b>ACTIVE</b>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void activateGeoVersion(release.id, release.version)
                    }
                  >
                    Activate / Rollback
                  </button>
                )}
              </article>
            ))
          ) : (
            <div className="geo3d-release-empty">
              Preview verify karke first immutable Geo Release publish karein.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

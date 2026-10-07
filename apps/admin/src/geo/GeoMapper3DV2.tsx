import { useEffect, useMemo, useRef, useState } from "react";
import {
  activateGeoRelease,
  createGeoExperience,
  geoMapsSettings,
  geoReleases,
  projects,
  publishGeoRelease,
  releases,
  saveGeoMapsKey,
  session,
  verifyGeoPreview,
  type CloudGeoReleaseState,
  type CloudProjectSummary,
  type CloudReleaseSummary,
} from "../studio/cloud";
import GeoModelPreview from "./GeoModelPreview";
import {
  createGeoV2Anchor,
  loadGeoV2,
  saveGeoV2,
  type GeoAnchorKind,
  type GeoHeightMode,
  type GeoV2State,
} from "./geoV2Api";
import "./geo-mapper.css";
import "./geo-v2.css";

type IntegrationModel = {
  id: string;
  name: string;
  mimeType: string;
  available?: boolean;
  url?: string;
  variant?: string;
};

type IntegrationPayload = {
  model?: IntegrationModel;
  geoModel?: IntegrationModel & { sourceModelId?: string };
  release?: { id: string; version: number };
  error?: string;
};

type FormState = {
  longitude: string;
  latitude: string;
  altitudeM: string;
  eastOffsetM: string;
  northOffsetM: string;
  verticalOffsetM: string;
  headingDeg: string;
  pitchDeg: string;
  rollDeg: string;
  scale: string;
  heightMode: GeoHeightMode;
  modelAnchorId: string;
};

type AnchorForm = {
  name: string;
  kind: GeoAnchorKind;
  xM: string;
  yM: string;
  zM: string;
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

type GeoWindow = Window & typeof globalThis & {
  google?: GoogleRoot;
  __rekixoEngineGeoV2MapsReady?: () => void;
};

let mapsPromise: Promise<GoogleRoot> | null = null;
let mapsKeyLoaded = "";

function requestedProjectSlug() {
  return new URLSearchParams(window.location.search)
    .get("project")
    ?.trim()
    .toLowerCase() || "";
}

function numberValue(value: string) {
  const result = Number(value);
  return Number.isFinite(result) ? result : NaN;
}

function validCoordinate(form: FormState) {
  const longitude = numberValue(form.longitude);
  const latitude = numberValue(form.latitude);
  return form.longitude.trim() !== "" && form.latitude.trim() !== "" &&
    longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}

function blankForm(): FormState {
  return {
    longitude: "",
    latitude: "",
    altitudeM: "0",
    eastOffsetM: "0",
    northOffsetM: "0",
    verticalOffsetM: "0",
    headingDeg: "0",
    pitchDeg: "0",
    rollDeg: "0",
    scale: "1",
    heightMode: "ground-relative",
    modelAnchorId: "",
  };
}

function formFromState(state: GeoV2State): FormState {
  const draft = state.draft;
  if (!draft) return blankForm();
  return {
    longitude: draft.longitude === null ? "" : String(draft.longitude),
    latitude: draft.latitude === null ? "" : String(draft.latitude),
    altitudeM: String(draft.altitudeM),
    eastOffsetM: String(draft.eastOffsetM),
    northOffsetM: String(draft.northOffsetM),
    verticalOffsetM: String(draft.verticalOffsetM),
    headingDeg: String(draft.headingDeg),
    pitchDeg: String(draft.pitchDeg),
    rollDeg: String(draft.rollDeg),
    scale: String(draft.scale),
    heightMode: draft.heightMode,
    modelAnchorId: draft.modelAnchorId || "",
  };
}

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

export default function GeoMapper3DV2() {
  const [projectList, setProjectList] = useState<CloudProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [state, setState] = useState<GeoV2State>();
  const [releaseItems, setReleaseItems] = useState<CloudReleaseSummary[]>([]);
  const [geoReleaseState, setGeoReleaseState] = useState<CloudGeoReleaseState>();
  const [engine, setEngine] = useState<IntegrationPayload>();
  const [sourceReleaseId, setSourceReleaseId] = useState("");
  const [form, setForm] = useState<FormState>(blankForm);
  const [anchorForm, setAnchorForm] = useState<AnchorForm>({
    name: "Main entrance",
    kind: "entrance",
    xM: "0",
    yM: "0",
    zM: "0",
  });
  const [mapsApiKey, setMapsApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    let live = true;
    void session()
      .then((value) => {
        if (!value.authenticated) {
          window.location.replace(
            `/3Dprojects/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`,
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
        const [projectResult, maps] = payload;
        setProjectList(projectResult.projects);
        if (maps.apiKey) setMapsApiKey(maps.apiKey);
        const requested = requestedProjectSlug();
        setSelectedSlug(
          projectResult.projects.find((item) => item.slug === requested)?.slug ||
            projectResult.projects[0]?.slug ||
            "",
        );
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Projects load nahi hue.");
      });
    return () => { live = false; };
  }, []);

  async function reload(slug = selectedSlug) {
    if (!slug) return;
    const [v2, buildingReleases, geoHistory, integrationState] = await Promise.all([
      loadGeoV2(slug),
      releases(slug),
      geoReleases(slug),
      integration(slug),
    ]);
    setState(v2);
    setReleaseItems(buildingReleases.releases);
    setGeoReleaseState(geoHistory);
    setEngine(integrationState);
    const source = v2.draft?.sourceBuildingReleaseId ||
      v2.experience?.sourceBuildingReleaseId ||
      v2.project.activeBuildingReleaseId ||
      "";
    setSourceReleaseId(source);
    setForm(formFromState(v2));
  }

  useEffect(() => {
    if (!selectedSlug) return;
    let live = true;
    setBusy(true);
    setError("");
    setMessage("");
    void reload(selectedSlug)
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Geo V2 load nahi hua.");
      })
      .finally(() => { if (live) setBusy(false); });
    const url = new URL(window.location.href);
    url.searchParams.set("project", selectedSlug);
    window.history.replaceState({}, "", url);
    return () => { live = false; };
  }, [selectedSlug]);

  const selectedRelease = useMemo(
    () => releaseItems.find((item) => item.id === sourceReleaseId),
    [releaseItems, sourceReleaseId],
  );
  const activeRelease = useMemo(
    () => releaseItems.find((item) => item.active),
    [releaseItems],
  );
  const sourcePreviewAvailable = Boolean(
    engine?.release?.id && sourceReleaseId === engine.release.id,
  );
  const renderModel = useMemo(() => {
    if (!sourcePreviewAvailable) return null;
    const source = engine?.model;
    const geo = engine?.geoModel;
    if (geo?.url && geo.mimeType === "model/gltf-binary" &&
      source && geo.sourceModelId === source.id) return geo;
    return source?.url && source.mimeType === "model/gltf-binary" ? source : null;
  }, [engine, sourcePreviewAvailable]);

  useEffect(() => {
    if (!mapsApiKey || !mapHostRef.current) return;
    let cancelled = false;
    let mapClick: { remove(): void } | null = null;
    let markerDrag: { remove(): void } | null = null;
    let marker: GoogleMarker | null = null;
    void loadGoogleMaps(mapsApiKey)
      .then((google) => {
        if (cancelled || !mapHostRef.current) return;
        const hasCoords = validCoordinate(formRef.current);
        const center = hasCoords
          ? { lat: Number(formRef.current.latitude), lng: Number(formRef.current.longitude) }
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
        });
        marker = new google.maps.Marker({ map, position: center, draggable: true, title: "WGS84 Building anchor" });
        markerRef.current = marker;
        const setCoordinate = (lat: number, lng: number) => {
          setForm((current) => ({ ...current, latitude: lat.toFixed(7), longitude: lng.toFixed(7) }));
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
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Map load nahi hua.");
      });
    return () => {
      cancelled = true;
      mapClick?.remove();
      markerDrag?.remove();
      marker?.setMap(null);
      markerRef.current = null;
      mapHostRef.current?.replaceChildren();
    };
  }, [mapsApiKey, selectedSlug]);

  useEffect(() => {
    if (!validCoordinate(form)) return;
    markerRef.current?.setPosition({
      lat: Number(form.latitude),
      lng: Number(form.longitude),
    });
  }, [form.longitude, form.latitude]);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Geo operation failed.");
    } finally {
      setBusy(false);
    }
  }

  function draftBody(modelAnchorId = form.modelAnchorId || null) {
    if (!state?.draft) throw new Error("Geo draft missing.");
    if (!sourceReleaseId || !selectedRelease) throw new Error("Building release select karein.");
    if (!validCoordinate(form)) throw new Error("Valid WGS84 longitude/latitude required hai.");
    const numeric = {
      altitudeM: numberValue(form.altitudeM),
      eastOffsetM: numberValue(form.eastOffsetM),
      northOffsetM: numberValue(form.northOffsetM),
      verticalOffsetM: numberValue(form.verticalOffsetM),
      headingDeg: numberValue(form.headingDeg),
      pitchDeg: numberValue(form.pitchDeg),
      rollDeg: numberValue(form.rollDeg),
      scale: numberValue(form.scale),
    };
    if (Object.values(numeric).some((value) => !Number.isFinite(value)))
      throw new Error("All Geo alignment values finite numbers hone chahiye.");
    return {
      expectedRevision: state.draft.revision,
      sourceBuildingReleaseId: sourceReleaseId,
      longitude: Number(form.longitude),
      latitude: Number(form.latitude),
      ...numeric,
      heightMode: form.heightMode,
      modelAnchorId,
    };
  }

  async function save() {
    const next = await saveGeoV2(selectedSlug, draftBody());
    setState(next);
    setForm(formFromState(next));
    setSourceReleaseId(next.draft?.sourceBuildingReleaseId || sourceReleaseId);
    setMessage(next.draft?.modelAnchorId
      ? "WGS84 + ENU rigid alignment saved. Preview verify kar sakte hain."
      : "Alignment saved. Ab exact Building-local model anchor create/select karein.");
  }

  async function createAnchor() {
    if (!selectedRelease) throw new Error("Building release select karein.");
    // Source ownership must be saved first. If the release changed, save with
    // no anchor, reload, then create the new release-pinned anchor.
    if (state?.experience?.sourceBuildingReleaseId !== sourceReleaseId) {
      const switched = await saveGeoV2(selectedSlug, draftBody(null));
      setState(switched);
      setForm(formFromState(switched));
    }
    const values = [anchorForm.xM, anchorForm.yM, anchorForm.zM].map(Number);
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error("Model anchor X/Y/Z canonical metres me finite hone chahiye.");
    const next = await createGeoV2Anchor(selectedSlug, {
      sourceBuildingReleaseId: sourceReleaseId,
      kind: anchorForm.kind,
      name: anchorForm.name.trim(),
      xM: values[0],
      yM: values[1],
      zM: values[2],
    });
    const created = next.anchors.find((anchor) =>
      anchor.sourceBuildingReleaseId === sourceReleaseId &&
      anchor.name === anchorForm.name.trim() &&
      anchor.xM === values[0] && anchor.yM === values[1] && anchor.zM === values[2],
    );
    setState(next);
    if (created) {
      const selected = await saveGeoV2(selectedSlug, {
        ...draftBody(created.id),
        expectedRevision: next.draft?.revision ?? state?.draft?.revision ?? 0,
      });
      setState(selected);
      setForm(formFromState(selected));
      setMessage(`Model anchor “${created.name}” created and selected.`);
    } else {
      setMessage("Model anchor created. Select it and save alignment.");
    }
  }

  async function enableGeo() {
    const source = activeRelease || selectedRelease;
    if (!source) throw new Error("Publish one Building release before enabling Geo.");
    await createGeoExperience(selectedSlug, source.id);
    await reload(selectedSlug);
    setMessage("Optional Geo Experience created. Set WGS84 + ENU alignment next.");
  }

  async function verify() {
    if (!state?.draft?.modelAnchorId)
      throw new Error("Explicit Building model anchor select karke save karein.");
    if (sourceReleaseId !== state.project.activeBuildingReleaseId)
      throw new Error("Preview verification ke liye selected Building release current active release hona chahiye.");
    await verifyGeoPreview(selectedSlug, state.draft.revision);
    await reload(selectedSlug);
    setMessage("Current Geo V2 preview revision verified.");
  }

  async function publish() {
    if (!state?.draft) throw new Error("Geo draft missing.");
    if (!geoReleaseState?.previewVerified)
      throw new Error("Current Geo preview ko pehle verify karein.");
    await publishGeoRelease(selectedSlug, state.draft.revision);
    await reload(selectedSlug);
    setMessage("Immutable Geo V2 release published and activated.");
  }

  async function activate(id: string) {
    await activateGeoRelease(selectedSlug, id);
    await reload(selectedSlug);
    setMessage("Selected immutable Geo release activated.");
  }

  async function saveKey() {
    if (!mapsApiKey.trim()) throw new Error("Google Maps browser key enter karein.");
    await saveGeoMapsKey(mapsApiKey.trim());
    setMessage("Google Maps browser key saved.");
  }

  const previewPlacement = {
    altitudeM: numberValue(form.verticalOffsetM) || 0,
    headingDeg: numberValue(form.headingDeg) || 0,
    pitchDeg: numberValue(form.pitchDeg) || 0,
    rollDeg: numberValue(form.rollDeg) || 0,
    scale: Math.max(0.001, numberValue(form.scale) || 1),
  };

  return (
    <main className="geo3d-shell geo3d-v2-shell">
      <header className="geo3d-topbar">
        <div>
          <p className="eyebrow">REKIXO AR3D ENGINE · GEO V2</p>
          <h1>WGS84 + ENU 3D Geo Mapper</h1>
          <p>Rigid Building placement only. Masterplan calibration never warps Building geometry.</p>
        </div>
        <div className="geo3d-actions">
          <select value={selectedSlug} disabled={busy} onChange={(event) => setSelectedSlug(event.target.value)}>
            {projectList.map((project) => <option key={project.id} value={project.slug}>{project.name}</option>)}
          </select>
          {selectedSlug && <a href={`/3Dprojects/${encodeURIComponent(selectedSlug)}/geo`} target="_blank" rel="noreferrer">Public Geo</a>}
          <a href="/3Dprojects">Projects</a>
        </div>
      </header>

      {error && <div className="geo3d-alert geo3d-alert--error">{error}</div>}
      {message && <div className="geo3d-alert geo3d-alert--ok">{message}</div>}

      <section className="geo3d-health">
        <article><span>BUILDING SOURCE</span><strong>{selectedRelease ? `v${selectedRelease.version}` : "—"}</strong><small>{sourcePreviewAvailable ? "Immutable preview available" : "Select active release for verification"}</small></article>
        <article><span>GEO DRAFT</span><strong>{state?.draft ? `r${state.draft.revision}` : "Not enabled"}</strong><small>{state?.draft?.modelAnchorId ? "Explicit model anchor selected" : "Anchor required"}</small></article>
        <article><span>VERIFICATION</span><strong>{geoReleaseState?.previewVerified ? "Verified" : "Pending"}</strong><small>Exact current revision only</small></article>
        <article><span>LIVE GEO</span><strong>{geoReleaseState?.activeRelease ? `v${geoReleaseState.activeRelease.version}` : "None"}</strong><small>Immutable Geo release</small></article>
      </section>

      {!state?.experience ? (
        <section className="geo3d-form-card">
          <div className="geo3d-section-head"><div><p className="eyebrow">OPTIONAL EXPERIENCE</p><h3>Enable 3D Geo for this project</h3></div></div>
          <p className="geo3d-help">Building release stays independent. Geo pins one immutable Building release and adds geographic truth.</p>
          <div className="geo3d-save-row"><button className="geo3d-primary" disabled={busy || !activeRelease} onClick={() => void run(enableGeo)}>Enable Geo Experience</button></div>
        </section>
      ) : (
        <>
          <section className="geo3d-form-card geo3d-source-card">
            <div className="geo3d-section-head"><div><p className="eyebrow">PINNED BUILDING SOURCE</p><h3>Immutable Building Release</h3></div><span className="geo3d-draft-badge">{state.experience.lifecycle}</span></div>
            <div className="geo3d-source-grid">
              <label><span>BUILDING RELEASE</span><select value={sourceReleaseId} disabled={busy} onChange={(event) => { setSourceReleaseId(event.target.value); patch("modelAnchorId", ""); }}>
                {releaseItems.map((release) => <option key={release.id} value={release.id}>v{release.version}{release.active ? " · ACTIVE" : ""} · {release.id}</option>)}
              </select></label>
              <div className="geo3d-source-note"><strong>{sourceReleaseId === state.project.activeBuildingReleaseId ? "Active Building release" : "Historical Building release"}</strong><span>Preview verification deliberately requires the selected source to be active, preventing unseen release drift.</span></div>
            </div>
          </section>

          <section className="geo3d-workspace">
            <article className="geo3d-map-card">
              <div className="geo3d-section-head"><div><p className="eyebrow">WGS84 TRUTH</p><h3>Geographic anchor</h3></div></div>
              {mapsApiKey ? <div ref={mapHostRef} className="geo3d-map" /> : <div className="geo3d-map-placeholder"><strong>Google Maps key required</strong><span>Save the browser key below.</span></div>}
              <p className="geo3d-help">Click/drag marker to set latitude/longitude. Fine placement uses ENU metre offsets, not repeated lat/lng nudging.</p>
            </article>
            <article className="geo3d-preview-card">
              <div className="geo3d-section-head"><div><p className="eyebrow">RIGID MODEL PREVIEW</p><h3>Building orientation</h3></div><div className="geo3d-preview-status"><strong>{renderModel?.variant || "building"}</strong><span>{renderModel?.name || "No active preview"}</span></div></div>
              <GeoModelPreview modelUrl={renderModel?.url || null} placement={previewPlacement} />
              <p className="geo3d-help">Preview is rigid/uniform-scale only. Exact Building-local anchor is selected below and public Geo applies it in ENU.</p>
            </article>
          </section>

          <section className="geo3d-form-card">
            <div className="geo3d-section-head"><div><p className="eyebrow">RIGID ALIGNMENT</p><h3>WGS84 + local ENU</h3></div></div>
            <div className="geo3d-form-grid">
              {(["longitude", "latitude", "eastOffsetM", "northOffsetM", "verticalOffsetM", "headingDeg", "pitchDeg", "rollDeg", "scale", "altitudeM"] as const).map((key) => (
                <label key={key}><span>{key.toUpperCase()}</span><input value={form[key]} onChange={(event) => patch(key, event.target.value)} /></label>
              ))}
              <label><span>HEIGHT MODE</span><select value={form.heightMode} onChange={(event) => patch("heightMode", event.target.value as GeoHeightMode)}><option value="ground-clamped">ground-clamped</option><option value="ground-relative">ground-relative</option><option value="absolute">absolute</option></select></label>
              <label><span>MODEL ANCHOR</span><select value={form.modelAnchorId} onChange={(event) => patch("modelAnchorId", event.target.value)}><option value="">Select explicit anchor</option>{state.anchors.filter((anchor) => anchor.sourceBuildingReleaseId === sourceReleaseId).map((anchor) => <option key={anchor.id} value={anchor.id}>{anchor.name} · {anchor.kind}</option>)}</select></label>
            </div>
            <div className="geo3d-save-row"><button className="geo3d-primary" disabled={busy} onClick={() => void run(save)}>Save Geo V2 Draft</button><span>Saving changes revision and invalidates prior preview verification.</span></div>
          </section>

          <section className="geo3d-form-card">
            <div className="geo3d-section-head"><div><p className="eyebrow">BUILDING-LOCAL ANCHOR</p><h3>Create explicit model anchor</h3></div></div>
            <div className="geo3d-form-grid">
              <label><span>NAME</span><input value={anchorForm.name} onChange={(event) => setAnchorForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label><span>KIND</span><select value={anchorForm.kind} onChange={(event) => setAnchorForm((current) => ({ ...current, kind: event.target.value as GeoAnchorKind }))}><option value="entrance">entrance</option><option value="main-gate">main-gate</option><option value="site-center">site-center</option><option value="south-west-corner">south-west-corner</option><option value="custom">custom</option></select></label>
              {(["xM", "yM", "zM"] as const).map((key) => <label key={key}><span>{key.toUpperCase()} · CANONICAL M</span><input value={anchorForm[key]} onChange={(event) => setAnchorForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
            </div>
            <p className="geo3d-help">These coordinates are measured in the immutable Building model's canonical metre frame. They are never guessed from map pixels.</p>
            <div className="geo3d-save-row"><button disabled={busy} onClick={() => void run(createAnchor)}>Create & Select Anchor</button></div>
          </section>

          <section className="geo3d-form-card">
            <div className="geo3d-section-head"><div><p className="eyebrow">VERIFY → IMMUTABLE RELEASE</p><h3>Publication gate</h3></div></div>
            <div className="geo3d-save-row">
              <button disabled={busy || !state.draft?.modelAnchorId} onClick={() => void run(verify)}>Verify Current Preview</button>
              <button className="geo3d-primary" disabled={busy || !geoReleaseState?.previewVerified} onClick={() => void run(publish)}>Publish Immutable Geo Release</button>
            </div>
            {!!geoReleaseState?.releases.length && <div className="geo-v2-release-list">{geoReleaseState.releases.map((release) => <article key={release.id}><div><strong>Geo v{release.version}{release.active ? " · LIVE" : ""}</strong><small>{release.id}</small></div>{!release.active && <button disabled={busy} onClick={() => void run(() => activate(release.id))}>Activate</button>}</article>)}</div>}
          </section>
        </>
      )}

      <section className="geo3d-form-card">
        <div className="geo3d-section-head"><div><p className="eyebrow">MAP PROVIDER</p><h3>Browser key</h3></div></div>
        <div className="geo3d-key-row"><input type="password" value={mapsApiKey} onChange={(event) => setMapsApiKey(event.target.value)} placeholder="Google Maps browser API key" /><button disabled={busy} onClick={() => void run(saveKey)}>Save Key</button></div>
      </section>
    </main>
  );
}

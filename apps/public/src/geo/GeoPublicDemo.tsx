import { useEffect, useMemo, useRef, useState } from "react";
import { Viewer3D } from "../viewer/Viewer3D";
import "./geo-public-demo.css";

type GeoPayload = {
  project: { id: string; slug: string; name: string; location?: string };
  release: { id: string; version: number };
  placement: {
    longitude: number;
    latitude: number;
    altitudeM: number;
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
    scale: number;
  };
  maps: { apiKey: string | null; configured: boolean };
  model: {
    id: string;
    name: string;
    mimeType: string;
    byteSize?: number;
    url: string;
    variant?: string;
    sha256?: string;
  };
  error?: string;
};

type LatLngLike = { lat(): number; lng(): number };
type GoogleMap = {
  setCenter(position: { lat: number; lng: number }): void;
};
type GoogleMarker = { setMap(map: GoogleMap | null): void };
type GooglePolyline = { setMap(map: GoogleMap | null): void };
type GoogleRoot = {
  maps: {
    Map: new (node: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    Polyline: new (options: Record<string, unknown>) => GooglePolyline;
  };
};

type GeoWindow = Window &
  typeof globalThis & {
    google?: GoogleRoot;
    __rekixoPublicJioMapsReady?: () => void;
  };

let mapsPromise: Promise<GoogleRoot> | null = null;
let mapsKeyLoaded = "";

function loadGoogleMaps(apiKey: string) {
  const geoWindow = window as GeoWindow;
  if (geoWindow.google?.maps?.Map && mapsKeyLoaded === apiKey)
    return Promise.resolve(geoWindow.google);
  if (mapsPromise && mapsKeyLoaded === apiKey) return mapsPromise;

  mapsKeyLoaded = apiKey;
  mapsPromise = new Promise<GoogleRoot>((resolve, reject) => {
    const callback = "__rekixoPublicJioMapsReady";
    geoWindow[callback] = () => {
      if (geoWindow.google?.maps?.Map) resolve(geoWindow.google);
      else reject(new Error("Google Maps initialize nahi hui."));
    };
    const existing = document.getElementById("rekixo-public-jio-maps-js");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "rekixo-public-jio-maps-js";
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

function headingEnd(latitude: number, longitude: number, headingDeg: number) {
  const heading = (headingDeg * Math.PI) / 180;
  const distanceM = 24;
  const northM = Math.cos(heading) * distanceM;
  const eastM = Math.sin(heading) * distanceM;
  const lat = latitude + northM / 111_320;
  const cosLat = Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const lng = longitude + eastM / (111_320 * cosLat);
  return { lat, lng };
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
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!slug) {
      setError("3D Jio project slug missing hai.");
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
          throw new Error(body.error || `3D Jio demo load failed (${response.status}).`);
        return body;
      })
      .then((body) => {
        setData(body);
        setError("");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "3D Jio demo load nahi hua.");
      });
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    if (!data?.maps.apiKey || !mapRef.current) return;
    let cancelled = false;
    let marker: GoogleMarker | null = null;
    let heading: GooglePolyline | null = null;

    void loadGoogleMaps(data.maps.apiKey)
      .then((google) => {
        if (cancelled || !mapRef.current) return;
        const center = {
          lat: data.placement.latitude,
          lng: data.placement.longitude,
        };
        const map = new google.maps.Map(mapRef.current, {
          center,
          zoom: 20,
          mapTypeId: "hybrid",
          streetViewControl: false,
          mapTypeControl: true,
          fullscreenControl: true,
          gestureHandling: "greedy",
          tilt: 0,
          heading: 0,
        });
        marker = new google.maps.Marker({
          map,
          position: center,
          title: data.project.name,
        });
        heading = new google.maps.Polyline({
          map,
          path: [
            center,
            headingEnd(
              data.placement.latitude,
              data.placement.longitude,
              data.placement.headingDeg,
            ),
          ],
          strokeColor: "#21d395",
          strokeOpacity: 1,
          strokeWeight: 4,
        });
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Google Maps load nahi hui.");
      });

    return () => {
      cancelled = true;
      marker?.setMap(null);
      heading?.setMap(null);
      mapRef.current?.replaceChildren();
    };
  }, [data]);

  if (error)
    return (
      <main className="jio-public-state">
        <p className="eyebrow">REKIXO AR3D ENGINE</p>
        <h1>3D Jio demo unavailable</h1>
        <p>{error}</p>
      </main>
    );

  if (!data)
    return (
      <main className="jio-public-state">
        <p className="eyebrow">REKIXO AR3D ENGINE</p>
        <h1>Loading 3D Jio demo…</h1>
      </main>
    );

  const mapsUrl =
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${data.placement.latitude.toFixed(7)},${data.placement.longitude.toFixed(7)}`,
    )}`;

  return (
    <main className="jio-public-shell">
      <header className="jio-public-header">
        <div>
          <p className="eyebrow">LIVE 3D JIO DEMO</p>
          <h1>{data.project.name}</h1>
          <p>{data.project.location || "Rekixo AR3D Engine placement"}</p>
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
        <article><span>RELEASE</span><strong>v{data.release.version}</strong><small>{data.release.id}</small></article>
        <article><span>MODEL</span><strong>{data.model.name}</strong><small>{data.model.variant || "source"}</small></article>
        <article><span>ANCHOR</span><strong>{data.placement.latitude.toFixed(7)}</strong><small>{data.placement.longitude.toFixed(7)}</small></article>
        <article><span>ALIGNMENT</span><strong>{data.placement.headingDeg.toFixed(1)}°</strong><small>Scale {data.placement.scale.toFixed(3)} · Ground {data.placement.altitudeM.toFixed(2)}m</small></article>
      </section>

      <section className="jio-public-grid">
        <article className="jio-public-card">
          <div className="jio-public-card-head">
            <div><p className="eyebrow">GEO LOCATION</p><h2>Satellite anchor</h2></div>
          </div>
          {data.maps.configured ? (
            <div ref={mapRef} className="jio-public-map" aria-label={`${data.project.name} satellite location`} />
          ) : (
            <div className="jio-public-placeholder">
              <strong>Satellite map configuration pending</strong>
              <span>Building preview remains available.</span>
            </div>
          )}
          <p className="jio-public-note">
            Green line building heading dikhati hai. Geo anchor release ke saath pinned hai.
          </p>
        </article>

        <article className="jio-public-card jio-public-model">
          <div className="jio-public-card-head">
            <div><p className="eyebrow">3D BUILDING</p><h2>Live model preview</h2></div>
          </div>
          <Viewer3D
            modelUrl={data.model.url}
            modelLabel={data.model.name}
            compactUi
            presentationView="building"
          />
          <p className="jio-public-note">
            Drag = rotate · wheel/pinch = zoom. Public demo read-only hai; placement edit sirf Engine Admin se hota hai.
          </p>
        </article>
      </section>
    </main>
  );
}

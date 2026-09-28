import { useEffect, useMemo, useState } from "react";
import SceneCanvas, { type View } from "./SceneCanvas";
import { loadPublished, type PublishedDesign } from "./published";
import "./studio.css";
export default function PublishedViewer() {
  const slug = location.pathname.replace(/\/$/, "").split("/").pop() ?? "";
  const [design, setDesign] = useState<PublishedDesign>();
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("building");
  const [roomId, setRoomId] = useState("");
  useEffect(() => {
    let active = true;
    loadPublished(slug)
      .then((d) => {
        if (active) {
          setDesign(d);
          setRoomId(d.project.scene.rooms[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [slug]);
  const resolveAsset = useMemo(
    () => async (key: string) => design?.files.find((f) => f.id === key),
    [design],
  );
  if (!design)
    return (
      <main className="studio">
        <h1>Published 3D design</h1>
        <p role="status">{error || "Loading published 3D design…"}</p>
        <a href="/3Dprojects/studio">Design Admin</a>
      </main>
    );
  const room = design.project.scene.rooms.find((r) => r.id === roomId);
  return (
    <main className="studio published-design">
      <header className="studio-head">
        <div>
          <small>REKIXO · PUBLISHED 3D DESIGN</small>
          <h1>{design.project.name}</h1>
        </div>
        <a href="/3Dprojects/studio">Open Design Admin</a>
      </header>
      <nav className="canvas-toolbar" aria-label="Project views">
        {(["building", "rooms", "walk"] as View[]).map((v) => (
          <button
            key={v}
            disabled={v !== "building" && !room}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === "building"
              ? "Building"
              : v === "rooms"
                ? "Interior draft"
                : "Walk room"}
          </button>
        ))}
        <label>
          Room{" "}
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {design.project.scene.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.unit} · {r.name}
              </option>
            ))}
          </select>
        </label>
      </nav>
      <section className="published-canvas">
        <SceneCanvas
          scene={design.project.scene}
          resolveAsset={resolveAsset}
          roomId={roomId}
          selected={roomId}
          view={view}
          onSelect={(key) => {
            if (design.project.scene.rooms.some((r) => r.id === key))
              setRoomId(key);
          }}
          onMesh={() => {}}
        />
      </section>
      <footer className="storage-banner">
        Drag to rotate · scroll/pinch to zoom.{" "}
        {room && view !== "building" && (
          <span>
            {room.width} × {room.depth} × {room.height} m ·{" "}
            {room.verified
              ? "Reviewed dimensions"
              : "Draft interior layout — requires alignment and review"}
          </span>
        )}
        <span>
          Published snapshot · editing a local copy does not change this link.
        </span>
      </footer>
    </main>
  );
}

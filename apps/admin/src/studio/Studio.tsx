import { useEffect, useRef, useState } from "react";
import SceneCanvas, { type View } from "./SceneCanvas";
import {
  catalog,
  id,
  newProject,
  snapshot,
  validateProject,
  type Asset,
  type Furniture,
  type Kind,
  type Project,
  type Room,
} from "./domain";
import * as storage from "./storage";
import "./studio.css";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function Studio() {
  const [project, setProject] = useState<Project>(),
    [list, setList] = useState<Project[]>([]),
    [files, setFiles] = useState<Asset[]>([]),
    [roomId, setRoomId] = useState(""),
    [selected, setSelected] = useState(""),
    [view, setView] = useState<View>("rooms"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [review, setReview] = useState(""),
    [backup, setBackup] = useState<{ url: string; name: string }>(),
    [mesh, setMesh] = useState("");
  const undo = useRef<Project[]>([]),
    redo = useRef<Project[]>([]);
  const modelInput = useRef<HTMLInputElement>(null),
    referenceInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    const entries = await storage.projects();
    setList(entries.sort((a, b) => b.updated.localeCompare(a.updated)));
  }
  function open(p: Project) {
    setBackup(undefined);
    setMessage("");
    setMesh("");
    setProject(p);
    setRoomId(p.scene.rooms[0]?.id ?? "");
    setSelected(p.scene.rooms[0]?.id ?? "");
    setReview("");
    setView(p.scene.modelId ? "building" : "rooms");
    setDirty(false);
    undo.current = [];
    redo.current = [];
    setError("");
  }
  useEffect(() => {
    return () => {
      if (backup) URL.revokeObjectURL(backup.url);
    };
  }, [backup]);
  useEffect(() => {
    let active = true;
    void storage
      .projects()
      .then((p) => {
        if (!active) return;
        p.sort((a, b) => b.updated.localeCompare(a.updated));
        setList(p);
        open(p[0] ?? newProject("Untitled project"));
      })
      .catch(() =>
        setError(
          "Cannot open browser storage. Enable site storage to use Studio.",
        ),
      );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!project) return;
    void Promise.all(project.assets.map(storage.asset))
      .then((a) => {
        if (active) setFiles(a.filter((f): f is Asset => Boolean(f)));
      })
      .catch(() => setError("Could not read project assets."));
    return () => {
      active = false;
    };
  }, [project?.id, project?.assets]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function edit(next: Project) {
    if (!project) return;
    setBackup(undefined);
    undo.current.push(project);
    if (undo.current.length > 40) undo.current.shift();
    redo.current = [];
    setProject(next);
    setDirty(true);
    setMessage("");
    setError("");
  }
  async function task(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function persist(p: Project, assets: Asset[] = []) {
    const next = { ...p, updated: new Date().toISOString() };
    await storage.save(next, assets);
    setProject(next);
    setDirty(false);
    await refresh();
    setMessage(
      "Saved on this device. Export a backup to keep a separate copy.",
    );
    return next;
  }
  function switchProject(p: Project) {
    if (dirty) {
      setError("Save your changes before switching projects.");
      return;
    }
    open(p);
  }
  function history(back: boolean) {
    if (!project) return;
    const from = back ? undo : redo,
      to = back ? redo : undo,
      p = from.current.pop();
    if (p) {
      to.current.push(project);
      setProject(p);
      setDirty(true);
      setReview("");
    }
  }
  if (!project)
    return (
      <main className="studio">
        <p role="alert">{error || "Opening your workspace…"}</p>
      </main>
    );
  const p = project,
    release = p.releases.find((r) => r.id === review),
    scene = release?.scene ?? p.scene,
    room = scene.rooms.find((r) => r.id === roomId),
    item = scene.furniture.find((f) => f.id === selected),
    floor = scene.floors.find((f) => f.id === room?.floorId);
  function patchRoom(change: Partial<Room>) {
    if (!room) return;
    edit({
      ...p,
      scene: {
        ...p.scene,
        rooms: p.scene.rooms.map((r) =>
          r.id === room.id ? { ...r, ...change } : r,
        ),
      },
    });
  }
  function patchItem(change: Partial<Furniture>) {
    if (!item) return;
    edit({
      ...p,
      scene: {
        ...p.scene,
        furniture: p.scene.furniture.map((f) =>
          f.id === item.id ? { ...f, ...change } : f,
        ),
      },
    });
  }
  function addRoom() {
    const prev = p.scene.rooms.at(-1);
    const r: Room = {
      id: id(),
      name: `Room ${p.scene.rooms.length + 1}`,
      unit: room?.unit ?? "Unit 101",
      floorId: room?.floorId ?? p.scene.floors[0].id,
      x: prev ? prev.x + prev.width / 2 + 3 : 0,
      z: 0,
      width: 4,
      depth: 3.5,
      height: 2.8,
      color: "#cdbfa9",
      source: "",
      verified: false,
    };
    edit({ ...p, scene: { ...p.scene, rooms: [...p.scene.rooms, r] } });
    setRoomId(r.id);
    setSelected(r.id);
    setView("rooms");
  }
  function select(key: string) {
    setSelected(key);
    const r =
      scene.rooms.find((r) => r.id === key) ??
      scene.rooms.find(
        (r) => r.id === scene.furniture.find((f) => f.id === key)?.roomId,
      );
    if (r) setRoomId(r.id);
  }
  async function upload(file: File, model: boolean) {
    if (model && !/\.(glb|fbx)$/i.test(file.name))
      throw Error("Choose a GLB or FBX model.");
    const a = await storage.makeAsset(file, p.id);
    const next = {
      ...p,
      assets: [...p.assets, a.id],
      scene: {
        ...p.scene,
        ...(model
          ? {
              modelId: a.id,
              rooms: p.scene.rooms.map((r) => ({ ...r, mesh: undefined })),
            }
          : {}),
      },
    };
    await persist(next, [a]);
    undo.current = [];
    redo.current = [];
    if (model) {
      setMesh("");
      setView("building");
    }
  }
  const field = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    step = 0.1,
  ) => (
    <label>
      {label}
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return (
    <main className="studio">
      <header className="studio-head">
        <a className="studio-brand" href="/3Dprojects">
          R
          <span>
            REKIXO <small>3D DESIGN STUDIO</small>
          </span>
        </a>
        <div className="project-name">
          <input
            aria-label="Project name"
            value={p.name}
            disabled={Boolean(review) || busy}
            onChange={(e) => edit({ ...p, name: e.target.value })}
          />
          <span>
            {dirty ? "Unsaved changes" : "Local workspace"} ·{" "}
            {p.scene.rooms.length} rooms
          </span>
        </div>
        <div className="studio-actions">
          <button
            disabled={busy || Boolean(review)}
            onClick={() =>
              task(async () => {
                await persist(p);
              })
            }
          >
            Save draft
          </button>
          <button
            disabled={busy}
            onClick={() =>
              task(async () => {
                const blob = await storage.exportPackage(p);
                setBackup({
                  url: URL.createObjectURL(blob),
                  name: `${p.name.replace(/[^a-z0-9-]/gi, "-")}.rekixo.json`,
                });
                setMessage(
                  "Backup ready with models, references and review versions. Click Download backup to save the file.",
                );
              })
            }
          >
            Export backup
          </button>
          {backup && (
            <a href={backup.url} download={backup.name}>
              Download backup
            </a>
          )}
        </div>
      </header>
      <div className="storage-banner">
        YOUR DESIGN WORKSPACE{" "}
        <span>
          Saved in this browser • Export backups for another device. Review
          versions are local; they are not live publications.
        </span>
        <button disabled={busy} onClick={() => importInput.current?.click()}>
          Import backup
        </button>
      </div>
      {(error || message || busy) && (
        <div
          className={error ? "studio-feedback error" : "studio-feedback"}
          role={error ? "alert" : "status"}
        >
          {error || (busy ? "Working…" : message)}
        </div>
      )}
      <div className="studio-layout">
        <aside className="studio-sidebar">
          <div className="section-label">PROJECT LIBRARY</div>
          <select
            aria-label="Project library"
            value={list.some((i) => i.id === p.id) ? p.id : ""}
            disabled={busy}
            onChange={(e) => {
              const next = list.find((i) => i.id === e.target.value);
              if (next) switchProject(next);
            }}
          >
            <option value="" disabled>
              New unsaved project
            </option>
            {list.map((i) => (
              <option value={i.id} key={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <button
            className="wide"
            disabled={busy}
            onClick={() => {
              if (dirty) {
                setError("Save your changes before creating a project.");
                return;
              }
              open(newProject("Untitled project"));
            }}
          >
            + New project
          </button>
          <div className="section-label">
            BUILDING STRUCTURE{" "}
            <button
              disabled={busy || Boolean(review)}
              onClick={() => {
                const last = p.scene.floors.at(-1)!;
                edit({
                  ...p,
                  scene: {
                    ...p.scene,
                    floors: [
                      ...p.scene.floors,
                      {
                        id: id(),
                        name: `Floor ${p.scene.floors.length}`,
                        elevation: last.elevation + 3,
                      },
                    ],
                  },
                });
              }}
            >
              + Floor
            </button>
          </div>
          <div className="room-tree">
            {scene.floors.map((f) => (
              <section key={f.id}>
                <div className="floor-name">
                  ▱ {f.name} <small>{f.elevation} m</small>
                </div>
                {scene.rooms
                  .filter((r) => r.floorId === f.id)
                  .map((r) => (
                    <button
                      className={
                        r.id === roomId ? "tree-room active" : "tree-room"
                      }
                      key={r.id}
                      onClick={() => {
                        setRoomId(r.id);
                        setSelected(r.id);
                        if (view === "building") setView("rooms");
                      }}
                    >
                      <span>
                        {r.verified ? "◉" : "○"} {r.name}
                      </span>
                      <small>
                        {r.unit} · {(r.width * r.depth).toFixed(1)} m²
                      </small>
                    </button>
                  ))}
              </section>
            ))}
          </div>
          <button
            className="wide"
            disabled={busy || Boolean(review)}
            onClick={addRoom}
          >
            + Add measured room
          </button>
          <div className="section-label">SOURCE LIBRARY</div>
          <button
            className="wide"
            disabled={busy || Boolean(review)}
            onClick={() => modelInput.current?.click()}
          >
            ↑ Import model · GLB / FBX
          </button>
          <button
            className="wide"
            disabled={busy || Boolean(review)}
            onClick={() => referenceInput.current?.click()}
          >
            + Reference drawing or image
          </button>
          {local && !p.scene.modelId && (
            <button
              className="wide subtle"
              disabled={busy || Boolean(review)}
              onClick={() =>
                task(async () => {
                  const response = await fetch(
                    "/studio-assets/jyoti-source-preserved.glb",
                  );
                  if (!response.ok)
                    throw Error(
                      "Local Jyoti model unavailable. Use Import model.",
                    );
                  await upload(
                    new File(
                      [await response.blob()],
                      "jyoti-source-preserved.glb",
                      { type: "model/gltf-binary" },
                    ),
                    true,
                  );
                })
              }
            >
              Load local Jyoti model
            </button>
          )}
          <div className="asset-list">
            {files.map((f) => (
              <button
                key={f.id}
                title={f.hash}
                onClick={() => download(f.blob, f.name)}
              >
                <span>↧ {f.name}</span>
                <small>{(f.size / 1048576).toFixed(1)} MB · download</small>
              </button>
            ))}
          </div>
        </aside>
        <section className="studio-center">
          <nav className="canvas-toolbar" aria-label="Viewer modes">
            {(
              [
                ["building", "Building"],
                ["rooms", "Interior"],
                ["walk", "Walk room"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                disabled={v === "walk" && !room}
                onClick={() => setView(v)}
              >
                {label}
              </button>
            ))}
            <span />
            {!review && (
              <>
                <button
                  disabled={!undo.current.length || busy}
                  onClick={() => history(true)}
                >
                  Undo
                </button>
                <button
                  disabled={!redo.current.length || busy}
                  onClick={() => history(false)}
                >
                  Redo
                </button>
              </>
            )}
          </nav>
          <SceneCanvas
            scene={scene}
            roomId={roomId}
            selected={selected}
            view={view}
            onSelect={select}
            onMesh={setMesh}
          />
          {!scene.rooms.length && view !== "building" && (
            <div className="empty-guide">
              <b>Start with one room.</b>
              <p>
                Add a measured room, then choose furniture below.
                <br />
                Every project keeps its own rooms, sources and designs.
              </p>
            </div>
          )}
          <div className="catalog">
            <div>
              <b>{review ? "Customer review" : "Furniture library"}</b>
              <small>
                {review
                  ? release?.name
                  : room
                    ? `Place in ${room.name}`
                    : "Select a room to furnish"}
              </small>
            </div>
            {Object.entries(catalog).map(([kind, c]) => (
              <button
                key={kind}
                disabled={!room || Boolean(review) || busy}
                onClick={() => {
                  if (!room) return;
                  const f: Furniture = {
                    id: id(),
                    kind: kind as Kind,
                    roomId: room.id,
                    x: 0,
                    z: 0,
                    rotation: 0,
                    color: c.color,
                  };
                  const next = {
                    ...p,
                    scene: { ...p.scene, furniture: [...p.scene.furniture, f] },
                  };
                  try {
                    validateProject(next);
                    edit(next);
                    setSelected(f.id);
                    setView("rooms");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <span className={`furniture-icon ${kind}`} />
                {c.name}
                <small>
                  {c.width} × {c.depth} m
                </small>
              </button>
            ))}
          </div>
        </section>
        <aside className="studio-inspector">
          <div className="section-label">
            {review ? "REVIEW VERSION" : "DESIGN PROPERTIES"}
          </div>
          <fieldset disabled={Boolean(review) || busy}>
            {item ? (
              <>
                <h2>{catalog[item.kind].name}</h2>
                <p>Position relative to room centre, in metres.</p>
                {field("Position X", item.x, (x) => patchItem({ x }))}
                {field("Position Z", item.z, (z) => patchItem({ z }))}
                {field(
                  "Rotation °",
                  item.rotation,
                  (rotation) => patchItem({ rotation }),
                  15,
                )}
                <label>
                  Finish
                  <input
                    aria-label="Furniture finish"
                    type="color"
                    value={item.color}
                    onChange={(e) => patchItem({ color: e.target.value })}
                  />
                </label>
                <button
                  className="danger"
                  onClick={() => {
                    edit({
                      ...p,
                      scene: {
                        ...p.scene,
                        furniture: p.scene.furniture.filter(
                          (f) => f.id !== item.id,
                        ),
                      },
                    });
                    setSelected(roomId);
                  }}
                >
                  Remove furniture
                </button>
              </>
            ) : room ? (
              <>
                <h2>Room properties</h2>
                <label>
                  Room name
                  <input
                    value={room.name}
                    onChange={(e) => patchRoom({ name: e.target.value })}
                  />
                </label>
                <label>
                  Unit / flat
                  <input
                    value={room.unit}
                    onChange={(e) => patchRoom({ unit: e.target.value })}
                  />
                </label>
                <label>
                  Floor
                  <select
                    value={room.floorId}
                    onChange={(e) => patchRoom({ floorId: e.target.value })}
                  >
                    {p.scene.floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                {floor &&
                  field("Floor elevation (m)", floor.elevation, (elevation) =>
                    edit({
                      ...p,
                      scene: {
                        ...p.scene,
                        floors: p.scene.floors.map((f) =>
                          f.id === floor.id ? { ...f, elevation } : f,
                        ),
                      },
                    }),
                  )}
                <div className="property-grid">
                  {field("Width (m)", room.width, (width) =>
                    patchRoom({ width }),
                  )}
                  {field("Depth (m)", room.depth, (depth) =>
                    patchRoom({ depth }),
                  )}
                  {field("Height (m)", room.height, (height) =>
                    patchRoom({ height }),
                  )}
                  {field("Centre X (m)", room.x, (x) => patchRoom({ x }))}
                  {field("Centre Z (m)", room.z, (z) => patchRoom({ z }))}
                </div>
                <label>
                  Floor finish
                  <input
                    aria-label="Floor finish"
                    type="color"
                    value={room.color}
                    onChange={(e) => patchRoom({ color: e.target.value })}
                  />
                </label>
                <label>
                  Measurement source
                  <textarea
                    value={room.source}
                    placeholder="Drawing name, page and dimensions"
                    onChange={(e) => patchRoom({ source: e.target.value })}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={room.verified}
                    onChange={(e) => patchRoom({ verified: e.target.checked })}
                  />{" "}
                  Measurements reviewed
                </label>
                <p className="measurement-note">
                  {room.verified
                    ? "Reviewed by author"
                    : "Unverified draft measurements"}{" "}
                  · {(room.width * room.depth).toFixed(2)} m² clear rectangular
                  floor area
                </p>
                <label>
                  Model mesh binding
                  <input readOnly value={room.mesh ?? "Not bound"} />
                </label>
                <button disabled={!mesh} onClick={() => patchRoom({ mesh })}>
                  Bind clicked mesh
                </button>
                {mesh && <small className="wrap">Selected: {mesh}</small>}
                <p>
                  Binding identifies the source object; it does not move or
                  resize the room. Set its measured position above.
                </p>
                <button
                  className="danger"
                  onClick={() => {
                    edit({
                      ...p,
                      scene: {
                        ...p.scene,
                        rooms: p.scene.rooms.filter((r) => r.id !== room.id),
                        furniture: p.scene.furniture.filter(
                          (f) => f.roomId !== room.id,
                        ),
                      },
                    });
                    setRoomId("");
                    setSelected("");
                  }}
                >
                  Remove room
                </button>
              </>
            ) : (
              <p>Select a room or furniture item to edit its properties.</p>
            )}
            {field(
              "Model scale → metres",
              p.scene.scale,
              (scale) => edit({ ...p, scene: { ...p.scene, scale } }),
              0.001,
            )}
            <p>
              Confirm against a known drawing length. Imported units are not
              automatically certified.
            </p>
          </fieldset>
          <div className="section-label">REVIEW & VERSIONS</div>
          {review ? (
            <button className="wide primary" onClick={() => setReview("")}>
              Return to draft
            </button>
          ) : (
            <button
              className="wide primary"
              disabled={busy}
              onClick={() =>
                task(async () => {
                  const next = await persist(
                    snapshot(p, `Review ${p.releases.length + 1}`),
                  );
                  setReview(next.releases.at(-1)!.id);
                  setMessage(
                    "Immutable local review created. Live cloud publishing is not enabled.",
                  );
                })
              }
            >
              Create review version
            </button>
          )}
          {p.releases.map((r) => (
            <div className="review-row" key={r.id}>
              <button
                onClick={() => {
                  setReview(r.id);
                  setRoomId(r.scene.rooms[0]?.id ?? "");
                  setSelected("");
                }}
              >
                {r.name}
                <small>{new Date(r.date).toLocaleString()}</small>
              </button>
              {!review && (
                <button
                  title="Restore this version into draft"
                  disabled={busy}
                  onClick={() => {
                    edit({ ...p, scene: structuredClone(r.scene) });
                    setRoomId(r.scene.rooms[0]?.id ?? "");
                    setSelected("");
                  }}
                >
                  ↶
                </button>
              )}
            </div>
          ))}
          <p>
            Export a backup to move this project to another device. Public link
            publishing needs authenticated Engine storage.
          </p>
        </aside>
      </div>
      <input
        hidden
        ref={modelInput}
        type="file"
        accept=".glb,.fbx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void task(() => upload(file, true));
        }}
      />
      <input
        hidden
        ref={referenceInput}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.skb,.skp,.drs,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void task(() => upload(file, false));
        }}
      />
      <input
        hidden
        ref={importInput}
        type="file"
        accept=".json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void task(async () => {
              if (dirty)
                throw Error("Save changes before importing another project.");
              const next = await storage.importPackage(file);
              await refresh();
              open(next);
              setMessage(
                "Backup imported as a separate project; existing projects unchanged.",
              );
            });
        }}
      />
    </main>
  );
}

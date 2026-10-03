import fs from "node:fs";

const sceneCanvasPath = "apps/admin/src/studio/SceneCanvas.tsx";
const studioPath = "apps/admin/src/studio/Studio.tsx";

function replaceOne(source, needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1)
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(needle, replacement);
}

let canvas = fs.readFileSync(sceneCanvasPath, "utf8");

canvas = replaceOne(
  canvas,
  `import {\n  renderSiteElements,\n  siteElementTransformChange,\n} from "./sceneCanvasSite";\n`,
  `import {\n  renderSiteElements,\n  siteElementTransformChange,\n} from "./sceneCanvasSite";\nimport {\n  openingTransformChange,\n  renderArchitectureElements,\n  wallTransformChange,\n} from "./sceneCanvasArchitecture";\n`,
  "SceneCanvas architecture import",
);

canvas = replaceOne(
  canvas,
  `export interface RoomDrawResult {\n  x: number;\n  z: number;\n  width: number;\n  depth: number;\n}\n`,
  `export interface RoomDrawResult {\n  x: number;\n  z: number;\n  width: number;\n  depth: number;\n}\nexport interface WallDrawResult {\n  floorId: string;\n  start: RoomPoint;\n  end: RoomPoint;\n}\nexport interface OpeningPlacementResult {\n  floorId: string;\n  point: RoomPoint;\n}\n`,
  "SceneCanvas architecture result types",
);

canvas = replaceOne(
  canvas,
  `  roomMapEnabled?: boolean;\n  roomDraw?: {\n`,
  `  roomMapEnabled?: boolean;\n  architectureEditing?: boolean;\n  wallDraw?: {\n    enabled: boolean;\n    floorId: string;\n    snap: boolean;\n  };\n  openingPlacement?: {\n    enabled: boolean;\n    floorId: string;\n    snap: boolean;\n  };\n  onWallDraw?: (result: WallDrawResult) => void;\n  onOpeningPlace?: (result: OpeningPlacementResult) => void;\n  roomDraw?: {\n`,
  "SceneCanvas architecture props",
);

canvas = replaceOne(
  canvas,
  `    rooms: T.Group;\n    site: T.Group;\n    references: T.Group;\n`,
  `    rooms: T.Group;\n    site: T.Group;\n    architecture: T.Group;\n    references: T.Group;\n`,
  "SceneCanvas api architecture group",
);

canvas = replaceOne(
  canvas,
  `    roomDraft: T.Mesh;\n    polygonDraft: T.Group;\n`,
  `    roomDraft: T.Mesh;\n    wallDraft: T.Mesh;\n    polygonDraft: T.Group;\n`,
  "SceneCanvas api wall draft",
);

canvas = replaceOne(
  canvas,
  `    const model = new T.Group(),\n      rooms = new T.Group(),\n      site = new T.Group(),\n      references = new T.Group();\n    site.name = "Studio site and landscape";\n`,
  `    const model = new T.Group(),\n      rooms = new T.Group(),\n      site = new T.Group(),\n      architecture = new T.Group(),\n      references = new T.Group();\n    site.name = "Studio site and landscape";\n    architecture.name = "Studio editable architecture";\n`,
  "SceneCanvas architecture group init",
);

canvas = replaceOne(
  canvas,
  `    roomDraft.visible = false;\n    roomDraft.renderOrder = 30;\n    const polygonDraft = new T.Group();\n`,
  `    roomDraft.visible = false;\n    roomDraft.renderOrder = 30;\n    const wallDraft = new T.Mesh(\n      new T.BoxGeometry(1, 0.07, 0.09),\n      new T.MeshBasicMaterial({\n        color: 0xffb45e,\n        transparent: true,\n        opacity: 0.8,\n        depthWrite: false,\n      }),\n    );\n    wallDraft.visible = false;\n    wallDraft.renderOrder = 33;\n    const polygonDraft = new T.Group();\n`,
  "SceneCanvas wall draft init",
);

canvas = replaceOne(
  canvas,
  `      model,\n      site,\n      rooms,\n      roomDraft,\n`,
  `      model,\n      site,\n      architecture,\n      rooms,\n      roomDraft,\n      wallDraft,\n`,
  "SceneCanvas scene groups",
);

canvas = replaceOne(
  canvas,
  `          for (const root of [model, references]) {\n`,
  `          for (const root of [model, references, architecture]) {\n`,
  "SceneCanvas top focus architecture bounds",
);

canvas = replaceOne(
  canvas,
  `      const box =\n        view === "building" && model.children.length\n          ? new T.Box3().setFromObject(model)\n          : r\n`,
  `      const box =\n        view === "building" && model.children.length\n          ? new T.Box3().setFromObject(model)\n          : view === "building" && architecture.children.length\n            ? new T.Box3().setFromObject(architecture)\n          : r\n`,
  "SceneCanvas perspective focus architecture bounds",
);

canvas = replaceOne(
  canvas,
  `      rooms,\n      site,\n      references,\n`,
  `      rooms,\n      site,\n      architecture,\n      references,\n`,
  "SceneCanvas api architecture assignment",
);

canvas = replaceOne(
  canvas,
  `      roomDraft,\n      polygonDraft,\n`,
  `      roomDraft,\n      wallDraft,\n      polygonDraft,\n`,
  "SceneCanvas api wall draft assignment",
);

canvas = replaceOne(
  canvas,
  `      const furniture = current.scene.furniture.find(\n`,
  `      const selectedWall = current.scene.walls?.find(\n        (candidate) => candidate.id === current.selected,\n      );\n      if (selectedWall) {\n        current.onTransformCommit(\n          wallTransformChange(\n            selectedWall,\n            target,\n            current.transformMode ?? "translate",\n          ),\n        );\n        return;\n      }\n      const selectedOpening = current.scene.openings?.find(\n        (candidate) => candidate.id === current.selected,\n      );\n      if (selectedOpening) {\n        const change = openingTransformChange(\n          selectedOpening,\n          target,\n          current.transformMode ?? "translate",\n        );\n        if (change) current.onTransformCommit(change);\n        return;\n      }\n      const furniture = current.scene.furniture.find(\n`,
  "SceneCanvas architecture transform commits",
);

canvas = replaceOne(
  canvas,
  `    let roomDrawStart: T.Vector3 | undefined;\n    let roomStampCenter: T.Vector3 | undefined;\n`,
  `    let roomDrawStart: T.Vector3 | undefined;\n    let wallDrawStart: T.Vector3 | undefined;\n    let roomStampCenter: T.Vector3 | undefined;\n`,
  "SceneCanvas wall draw state",
);

canvas = replaceOne(
  canvas,
  `      for (const room of latest.current.scene.rooms) {\n        if (room.floorId !== floorId || room.id === excludeRoomId) continue;\n        const boundary = roomBoundaryPoints(room);\n        for (let index = 0; index < boundary.length; index += 1) {\n          const [ax, az] = boundary[index];\n          const [bx, bz] = boundary[(index + 1) % boundary.length];\n          segments.push({\n            id: \`${"${room.id}"}:${"${index}"}\`,\n            start: [ax, az],\n            end: [bx, bz],\n          });\n        }\n      }\n      const snapped = resolvePlanSnap`,
  `      for (const room of latest.current.scene.rooms) {\n        if (room.floorId !== floorId || room.id === excludeRoomId) continue;\n        const boundary = roomBoundaryPoints(room);\n        for (let index = 0; index < boundary.length; index += 1) {\n          const [ax, az] = boundary[index];\n          const [bx, bz] = boundary[(index + 1) % boundary.length];\n          segments.push({\n            id: \`${"${room.id}"}:${"${index}"}\`,\n            start: [ax, az],\n            end: [bx, bz],\n          });\n        }\n      }\n      for (const wall of latest.current.scene.walls ?? []) {\n        if (wall.floorId !== floorId) continue;\n        segments.push({\n          id: \`wall:${"${wall.id}"}\`,\n          start: wall.start,\n          end: wall.end,\n        });\n      }\n      const snapped = resolvePlanSnap`,
  "SceneCanvas wall-aware snapping",
);

canvas = replaceOne(
  canvas,
  `    const roomPlanePoint = (\n`,
  `    const architecturePlanePoint = (event: PointerEvent) => {\n      const config = latest.current.wallDraw?.enabled\n        ? latest.current.wallDraw\n        : latest.current.openingPlacement?.enabled\n          ? latest.current.openingPlacement\n          : undefined;\n      if (!config?.enabled || !config.floorId) return undefined;\n      return pointOnFloor(\n        event.clientX,\n        event.clientY,\n        config.floorId,\n        config.snap,\n      );\n    };\n\n    const roomPlanePoint = (\n`,
  "SceneCanvas architecture plane point",
);

canvas = replaceOne(
  canvas,
  `    const pointerDown = (e: PointerEvent) => {\n      renderer.domElement.focus();\n`,
  `    const pointerDown = (e: PointerEvent) => {\n      renderer.domElement.focus();\n      if (\n        e.button === 0 &&\n        latest.current.wallDraw?.enabled &&\n        latest.current.view === "building"\n      ) {\n        const start = architecturePlanePoint(e);\n        if (start) {\n          wallDrawStart = start;\n          wallDraft.visible = false;\n          controls.enabled = false;\n          renderer.domElement.setPointerCapture(e.pointerId);\n          point = {\n            x: e.clientX,\n            y: e.clientY,\n            ox: e.clientX,\n            oy: e.clientY,\n            id: e.pointerId,\n          };\n          setStatus("Drag to draw the wall · release to place");\n          return;\n        }\n      }\n      if (\n        e.button === 0 &&\n        latest.current.openingPlacement?.enabled &&\n        latest.current.view === "building"\n      ) {\n        renderer.domElement.setPointerCapture(e.pointerId);\n        point = {\n          x: e.clientX,\n          y: e.clientY,\n          ox: e.clientX,\n          oy: e.clientY,\n          id: e.pointerId,\n        };\n        return;\n      }\n`,
  "SceneCanvas architecture pointer down",
);

canvas = replaceOne(
  canvas,
  `    const move = (e: PointerEvent) => {\n      if (vertexDrag) {\n`,
  `    const move = (e: PointerEvent) => {\n      if (wallDrawStart && latest.current.wallDraw?.enabled) {\n        const end = architecturePlanePoint(e);\n        if (end) {\n          const dx = end.x - wallDrawStart.x;\n          const dz = end.z - wallDrawStart.z;\n          const length = Math.max(0.01, Math.hypot(dx, dz));\n          wallDraft.position.set(\n            (end.x + wallDrawStart.x) / 2,\n            wallDrawStart.y + 0.05,\n            (end.z + wallDrawStart.z) / 2,\n          );\n          wallDraft.rotation.y = Math.atan2(-dz, dx);\n          wallDraft.scale.set(length, 1, 1);\n          wallDraft.visible = true;\n        }\n        return;\n      }\n      if (vertexDrag) {\n`,
  "SceneCanvas architecture pointer move",
);

canvas = replaceOne(
  canvas,
  `    const click = (e: PointerEvent) => {\n      if (vertexDrag) {\n`,
  `    const click = (e: PointerEvent) => {\n      if (wallDrawStart) {\n        const start = wallDrawStart;\n        const end = architecturePlanePoint(e);\n        const floorId = latest.current.wallDraw?.floorId;\n        wallDrawStart = undefined;\n        wallDraft.visible = false;\n        point = undefined;\n        controls.enabled = latest.current.view !== "walk";\n        try {\n          renderer.domElement.releasePointerCapture(e.pointerId);\n        } catch {}\n        if (end && floorId) {\n          const length = Math.hypot(end.x - start.x, end.z - start.z);\n          if (length >= 0.2) {\n            latest.current.onWallDraw?.({\n              floorId,\n              start: [Number(start.x.toFixed(4)), Number(start.z.toFixed(4))],\n              end: [Number(end.x.toFixed(4)), Number(end.z.toFixed(4))],\n            });\n            setStatus("");\n          } else {\n            setStatus("Draw a wall at least 0.2 m long.");\n          }\n        }\n        return;\n      }\n      if (latest.current.openingPlacement?.enabled) {\n        if (!point) return;\n        const small = isPointerTap(\n          { clientX: point.ox, clientY: point.oy },\n          e,\n        );\n        point = undefined;\n        controls.enabled = latest.current.view !== "walk";\n        try {\n          renderer.domElement.releasePointerCapture(e.pointerId);\n        } catch {}\n        if (!small) return;\n        const target = architecturePlanePoint(e);\n        const floorId = latest.current.openingPlacement.floorId;\n        if (target && floorId)\n          latest.current.onOpeningPlace?.({\n            floorId,\n            point: [Number(target.x.toFixed(4)), Number(target.z.toFixed(4))],\n          });\n        return;\n      }\n      if (vertexDrag) {\n`,
  "SceneCanvas architecture pointer up",
);

canvas = replaceOne(
  canvas,
  `        latest.current.view === "building"\n          ? [...site.children, ...model.children]\n          : rooms.children,\n`,
  `        latest.current.view === "building"\n          ? [...architecture.children, ...site.children, ...model.children]\n          : rooms.children,\n`,
  "SceneCanvas architecture raycast",
);

canvas = replaceOne(
  canvas,
  `            n !== model &&\n            n !== site\n`,
  `            n !== model &&\n            n !== site &&\n            n !== architecture\n`,
  "SceneCanvas architecture ray ancestor",
);

canvas = replaceOne(
  canvas,
  `    r.references.visible = props.view !== "walk";\n    r.site.visible = props.view === "building";\n`,
  `    r.references.visible = props.view !== "walk";\n    r.site.visible = props.view === "building";\n    r.architecture.visible =\n      props.view === "building" && Boolean(props.architectureEditing);\n`,
  "SceneCanvas architecture visibility",
);

canvas = replaceOne(
  canvas,
  `    renderSiteElements(\n      r.site,\n      props.view === "building" ? props.scene.siteElements ?? [] : [],\n      props.selected,\n      r.selectables,\n    );\n\n    for (const room of props.scene.rooms) {\n`,
  `    renderSiteElements(\n      r.site,\n      props.view === "building" ? props.scene.siteElements ?? [] : [],\n      props.selected,\n      r.selectables,\n    );\n    renderArchitectureElements(\n      r.architecture,\n      props.scene,\n      props.selected,\n      r.selectables,\n      {\n        visible: props.view === "building" && Boolean(props.architectureEditing),\n        floorId: props.isolateFloorId,\n      },\n    );\n\n    for (const room of props.scene.rooms) {\n`,
  "SceneCanvas architecture rendering",
);

canvas = replaceOne(
  canvas,
  `    props.roomMapEnabled,\n    props.soloRoomId,\n  ]);\n`,
  `    props.roomMapEnabled,\n    props.architectureEditing,\n    props.soloRoomId,\n  ]);\n`,
  "SceneCanvas architecture render dependency",
);

canvas = replaceOne(
  canvas,
  `    const isSiteElement = Boolean(\n      props.scene.siteElements?.some(\n        (element) => element.id === props.selected,\n      ),\n    );\n`,
  `    const isSiteElement = Boolean(\n      props.scene.siteElements?.some(\n        (element) => element.id === props.selected,\n      ),\n    );\n    const isArchitectureWall = Boolean(\n      props.scene.walls?.some((wall) => wall.id === props.selected),\n    );\n    const isArchitectureOpening = Boolean(\n      props.scene.openings?.some((opening) => opening.id === props.selected),\n    );\n`,
  "SceneCanvas architecture transform target flags",
);

canvas = replaceOne(
  canvas,
  `      (props.view === "building" &&\n        !props.roomMapEnabled &&\n        !isSiteElement)\n`,
  `      (props.view === "building" &&\n        !props.roomMapEnabled &&\n        !isSiteElement &&\n        !isArchitectureWall &&\n        !isArchitectureOpening)\n`,
  "SceneCanvas architecture transform gating",
);

canvas = replaceOne(
  canvas,
  `      (isRoom && mode === "rotate") ||\n      (isFurniture && mode === "scale") ||\n`,
  `      (isRoom && mode === "rotate") ||\n      (isArchitectureOpening && mode === "rotate") ||\n      (isFurniture && mode === "scale") ||\n`,
  "SceneCanvas opening rotation gating",
);

canvas = replaceOne(
  canvas,
  `  const authoringActive = Boolean(props.roomDraw?.enabled || props.roomStamp?.enabled ||\n    props.roomPolygonDraw?.enabled || props.furniturePlacement?.enabled);\n`,
  `  const authoringActive = Boolean(\n    props.wallDraw?.enabled ||\n      props.openingPlacement?.enabled ||\n      props.roomDraw?.enabled ||\n      props.roomStamp?.enabled ||\n      props.roomPolygonDraw?.enabled ||\n      props.furniturePlacement?.enabled,\n  );\n`,
  "SceneCanvas architecture authoring active",
);

fs.writeFileSync(sceneCanvasPath, canvas);

let studio = fs.readFileSync(studioPath, "utf8");

studio = replaceOne(
  studio,
  `  type SiteElement,\n} from "./domain";\n`,
  `  type SiteElement,\n  type Wall,\n} from "./domain";\nimport {\n  createManualOpening,\n  createManualWall,\n  moveManualOpening,\n  nearestWallForPoint,\n  patchManualOpening,\n  patchManualWall,\n  removeManualOpening,\n  removeManualWall,\n  setOpeningReviewed,\n  setWallReviewed,\n  wallLength,\n} from "./architectureAuthoring";\n`,
  "Studio architecture imports",
);

studio = replaceOne(
  studio,
  `  const [showFloorReview, setShowFloorReview] = useState(false);\n  const [roomMapFloorId, setRoomMapFloorId] = useState("");\n`,
  `  const [showFloorReview, setShowFloorReview] = useState(false);\n  const [architectureTool, setArchitectureTool] = useState<\n    "select" | "wall" | "door" | "window"\n  >("select");\n  const [architectureFloorId, setArchitectureFloorId] = useState("");\n  const [wallThickness, setWallThickness] = useState(0.12);\n  const [wallHeight, setWallHeight] = useState(2.8);\n  const [openingWidth, setOpeningWidth] = useState(0.9);\n  const [openingHeight, setOpeningHeight] = useState(2.1);\n  const [openingSillHeight, setOpeningSillHeight] = useState(0.9);\n  const [roomMapFloorId, setRoomMapFloorId] = useState("");\n`,
  "Studio architecture state",
);

studio = replaceOne(
  studio,
  `    setShowFloorReview(false);\n    setRoomMapFloorId(\n`,
  `    setShowFloorReview(false);\n    setArchitectureTool("select");\n    setArchitectureFloorId(\n      p.scene.rooms[0]?.floorId ?? p.scene.floors[0]?.id ?? "",\n    );\n    setWallThickness(0.12);\n    setWallHeight(2.8);\n    setOpeningWidth(0.9);\n    setOpeningHeight(2.1);\n    setOpeningSillHeight(0.9);\n    setRoomMapFloorId(\n`,
  "Studio architecture reset",
);

studio = replaceOne(
  studio,
  `      if (event.key === "Escape") setShowFloorReview(false);\n      if (review || busy) return;\n`,
  `      if (event.key === "Escape" && architectureTool !== "select") {\n        event.preventDefault();\n        setArchitectureTool("select");\n        setMessage("");\n        return;\n      }\n      if (event.key === "Escape") setShowFloorReview(false);\n      if (review || busy) return;\n`,
  "Studio architecture Escape",
);

studio = replaceOne(
  studio,
  `  }, [workspace, review, busy, project, editorFocus]);\n`,
  `  }, [workspace, review, busy, project, editorFocus, architectureTool]);\n`,
  "Studio architecture keyboard dependency",
);

studio = replaceOne(
  studio,
  `    item = scene.furniture.find((f) => f.id === selected),\n    siteElement = scene.siteElements?.find((entry) => entry.id === selected),\n    floor = scene.floors.find((f) => f.id === room?.floorId),\n`,
  `    item = scene.furniture.find((f) => f.id === selected),\n    siteElement = scene.siteElements?.find((entry) => entry.id === selected),\n    selectedWall = scene.walls?.find((entry) => entry.id === selected),\n    selectedOpening = scene.openings?.find((entry) => entry.id === selected),\n    activeArchitectureFloorId =\n      architectureFloorId ||\n      selectedWall?.floorId ||\n      selectedOpening?.floorId ||\n      isolateFloorId ||\n      room?.floorId ||\n      scene.floors[0]?.id ||\n      "",\n    floor = scene.floors.find((f) => f.id === room?.floorId),\n`,
  "Studio selected architecture derived state",
);

studio = replaceOne(
  studio,
  `  function placeFurnitureOnCanvas(placement: {\n`,
  `  function architectureProject(nextScene: Project["scene"], message?: string) {\n    const next: Project = { ...p, scene: nextScene };\n    validateProject(next);\n    edit(next);\n    if (message) setMessage(message);\n    return next;\n  }\n\n  function patchSelectedWall(\n    change: Partial<Pick<Wall, "start" | "end" | "thickness" | "height">>,\n  ) {\n    if (!selectedWall) return;\n    try {\n      architectureProject(\n        patchManualWall(p.scene, selectedWall.id, change),\n        "Wall updated. Review it again before publishing.",\n      );\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : "Wall update failed.");\n    }\n  }\n\n  function patchSelectedOpening(change: Partial<Opening>) {\n    if (!selectedOpening) return;\n    try {\n      architectureProject(\n        patchManualOpening(p.scene, selectedOpening.id, {\n          ...(change.kind !== undefined ? { kind: change.kind } : {}),\n          ...(change.width !== undefined ? { width: change.width } : {}),\n          ...(change.height !== undefined ? { height: change.height } : {}),\n          ...(change.sillHeight !== undefined\n            ? { sillHeight: change.sillHeight }\n            : {}),\n        }),\n        "Opening updated. Review it again before publishing.",\n      );\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : "Opening update failed.");\n    }\n  }\n\n  function moveSelectedOpening(x: number, z: number) {\n    if (!selectedOpening) return;\n    try {\n      architectureProject(\n        moveManualOpening(p.scene, selectedOpening.id, [x, z]),\n        "Opening moved onto its host wall. Review it again before publishing.",\n      );\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : "Opening move failed.");\n    }\n  }\n\n  function startArchitectureTool(tool: typeof architectureTool) {\n    const floorId =\n      activeArchitectureFloorId || p.scene.floors[0]?.id || "";\n    if (!floorId) {\n      setError("Create or detect a floor before editing architecture.");\n      return;\n    }\n    setArchitectureFloorId(floorId);\n    setArchitectureTool(tool);\n    setShowReferenceWorkspace(false);\n    setShowRoomMapper(false);\n    setShowFloorReview(false);\n    setShowAssetShelf(false);\n    setView("building");\n    setCameraOrientation("top");\n    setIsolateFloorId(floorId);\n    if (tool !== "select") {\n      setSelected("");\n      setMesh("");\n      setSelectedModelNodeKey("");\n    }\n    setMessage(\n      tool === "wall"\n        ? "Wall tool active · drag on the plan to draw a wall."\n        : tool === "door"\n          ? "Door tool active · click a room-associated wall to place a door."\n          : tool === "window"\n            ? "Window tool active · click a room-associated wall to place a window."\n            : "Select a wall, door or window to edit it.",\n    );\n  }\n\n  function commitArchitectureWall(result: {\n    floorId: string;\n    start: RoomPoint;\n    end: RoomPoint;\n  }) {\n    try {\n      const built = createManualWall(\n        p.scene,\n        {\n          floorId: result.floorId,\n          start: result.start,\n          end: result.end,\n          thickness: wallThickness,\n          height: wallHeight,\n        },\n        id,\n      );\n      architectureProject(built.scene);\n      setSelected(built.wall.id);\n      setArchitectureFloorId(built.wall.floorId);\n      setArchitectureTool("select");\n      setMessage(\n        `Wall created · ${wallLength(built.wall).toFixed(2)} m · ${built.wall.roomIds.length} room link${built.wall.roomIds.length === 1 ? "" : "s"}.`,\n      );\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : "Wall creation failed.");\n    }\n  }\n\n  function commitArchitectureOpening(result: {\n    floorId: string;\n    point: RoomPoint;\n  }) {\n    if (architectureTool !== "door" && architectureTool !== "window") return;\n    const hit = nearestWallForPoint(p.scene, result.floorId, result.point, 0.75);\n    if (!hit) {\n      setError("Click directly on an editable wall to place the opening.");\n      return;\n    }\n    try {\n      const built = createManualOpening(\n        p.scene,\n        {\n          wallId: hit.wall.id,\n          kind: architectureTool,\n          x: result.point[0],\n          z: result.point[1],\n          width: openingWidth,\n          height: openingHeight,\n          ...(architectureTool === "window"\n            ? { sillHeight: openingSillHeight }\n            : {}),\n        },\n        id,\n      );\n      architectureProject(built.scene);\n      setSelected(built.opening.id);\n      setArchitectureFloorId(built.opening.floorId);\n      setArchitectureTool("select");\n      setMessage(\n        `${built.opening.kind === "window" ? "Window" : "Door"} placed on wall · review dimensions, then accept it.`,\n      );\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : "Opening placement failed.");\n    }\n  }\n\n  function placeFurnitureOnCanvas(placement: {\n`,
  "Studio architecture mutation helpers",
);

studio = replaceOne(
  studio,
  `    setShowFloorReview(false);\n    setWorkspace("editor");\n`,
  `    setShowFloorReview(false);\n    setArchitectureTool("select");\n    setWorkspace("editor");\n`,
  "Studio alignment cancels architecture tool",
);

studio = replaceOne(
  studio,
  `    } else if (change.kind === "room") {\n`,
  `    } else if (change.kind === "wall") {\n      next = {\n        ...p,\n        scene: patchManualWall(p.scene, change.id, {\n          ...(change.start !== undefined ? { start: change.start } : {}),\n          ...(change.end !== undefined ? { end: change.end } : {}),\n          ...(change.thickness !== undefined\n            ? { thickness: change.thickness }\n            : {}),\n          ...(change.height !== undefined ? { height: change.height } : {}),\n        }),\n      };\n    } else if (change.kind === "opening") {\n      let nextScene = p.scene;\n      if (change.x !== undefined || change.z !== undefined) {\n        const current = nextScene.openings?.find(\n          (entry) => entry.id === change.id,\n        );\n        if (!current) return;\n        nextScene = moveManualOpening(nextScene, change.id, [\n          change.x ?? current.x,\n          change.z ?? current.z,\n        ]);\n      }\n      if (change.width !== undefined || change.height !== undefined)\n        nextScene = patchManualOpening(nextScene, change.id, {\n          ...(change.width !== undefined ? { width: change.width } : {}),\n          ...(change.height !== undefined ? { height: change.height } : {}),\n        });\n      next = { ...p, scene: nextScene };\n    } else if (change.kind === "room") {\n`,
  "Studio architecture transform handling",
);

studio = replaceOne(
  studio,
  `    if (r) {\n      setRoomId(r.id);\n      if (showRoomMapper) {\n`,
  `    const wall = scene.walls?.find((entry) => entry.id === key);\n    const opening = scene.openings?.find((entry) => entry.id === key);\n    if (wall || opening) {\n      const floorId = wall?.floorId ?? opening?.floorId ?? "";\n      setArchitectureFloorId(floorId);\n      setArchitectureTool("select");\n      setView("building");\n      setCameraOrientation("top");\n      setIsolateFloorId(floorId);\n    }\n    if (r) {\n      setRoomId(r.id);\n      if (showRoomMapper) {\n`,
  "Studio architecture selection",
);

studio = replaceOne(
  studio,
  `            {view === "rooms" && room && (\n`,
  `            {view === "building" && (\n              <div className="editor-mode-switch" role="group" aria-label="Architecture tools">\n                <select\n                  aria-label="Architecture floor"\n                  value={activeArchitectureFloorId}\n                  disabled={Boolean(review) || busy}\n                  onChange={(event) => {\n                    const floorId = event.target.value;\n                    setArchitectureFloorId(floorId);\n                    setIsolateFloorId(floorId);\n                    const target = scene.floors.find((entry) => entry.id === floorId);\n                    if (target) setSectionCutOffset(target.elevation + 1.5);\n                  }}\n                >\n                  {[...scene.floors]\n                    .sort((left, right) => left.elevation - right.elevation)\n                    .map((entry) => (\n                      <option key={entry.id} value={entry.id}>\n                        {entry.name}\n                      </option>\n                    ))}\n                </select>\n                {([\n                  ["select", "Select"],\n                  ["wall", "Wall"],\n                  ["door", "Door"],\n                  ["window", "Window"],\n                ] as const).map(([tool, label]) => (\n                  <button\n                    key={tool}\n                    type="button"\n                    className={architectureTool === tool ? "active" : ""}\n                    disabled={Boolean(review) || busy}\n                    onClick={() => startArchitectureTool(tool)}\n                  >\n                    {label}\n                  </button>\n                ))}\n              </div>\n            )}\n\n            {view === "rooms" && room && (\n`,
  "Studio architecture toolbar",
);

studio = replaceOne(
  studio,
  `                      !showReferenceWorkspace &&\n                      !siteElement &&\n                      !(showRoomMapper && Boolean(room) && selected === room?.id))\n`,
  `                      !showReferenceWorkspace &&\n                      !siteElement &&\n                      !selectedWall &&\n                      !selectedOpening &&\n                      !(showRoomMapper && Boolean(room) && selected === room?.id))\n`,
  "Studio move tool architecture enablement",
);

studio = replaceOne(
  studio,
  `                      (view === "building" && showReferenceWorkspace) ||\n                      Boolean(siteElement)\n`,
  `                      (view === "building" && showReferenceWorkspace) ||\n                      Boolean(siteElement) ||\n                      Boolean(selectedWall)\n`,
  "Studio rotate tool wall enablement",
);

studio = replaceOne(
  studio,
  `                    (!siteElement &&\n                      !(\n                        view === "rooms" ||\n                        (view === "building" && showRoomMapper)\n                      )) ||\n                    (!siteElement && !room) ||\n                    Boolean(item)\n`,
  `                    !(\n                      Boolean(siteElement) ||\n                      Boolean(selectedWall) ||\n                      Boolean(selectedOpening) ||\n                      (view === "rooms" && Boolean(room) && !item) ||\n                      (view === "building" &&\n                        showRoomMapper &&\n                        Boolean(room))\n                    ) ||\n                    Boolean(item)\n`,
  "Studio scale tool architecture enablement",
);

studio = replaceOne(
  studio,
  `                      if (next) {\n                        setRoomMapFloorId(next);\n`,
  `                      if (next) {\n                        setRoomMapFloorId(next);\n                        setArchitectureFloorId(next);\n`,
  "Studio floor selector architecture sync",
);

studio = replaceOne(
  studio,
  `            roomMapEnabled={showRoomMapper || showFloorReview}\n            roomDraw={{\n`,
  `            roomMapEnabled={showRoomMapper || showFloorReview}\n            architectureEditing={\n              view === "building" &&\n              !showReferenceWorkspace &&\n              !showRoomMapper &&\n              !showFloorReview\n            }\n            wallDraw={{\n              enabled:\n                architectureTool === "wall" &&\n                !showReferenceWorkspace &&\n                !showRoomMapper &&\n                !showFloorReview,\n              floorId: activeArchitectureFloorId,\n              snap: transformSnap,\n            }}\n            openingPlacement={{\n              enabled:\n                (architectureTool === "door" || architectureTool === "window") &&\n                !showReferenceWorkspace &&\n                !showRoomMapper &&\n                !showFloorReview,\n              floorId: activeArchitectureFloorId,\n              snap: transformSnap,\n            }}\n            onWallDraw={commitArchitectureWall}\n            onOpeningPlace={commitArchitectureOpening}\n            roomDraw={{\n`,
  "Studio SceneCanvas architecture props",
);

studio = replaceOne(
  studio,
  `            ) : siteElement ? (\n`,
  `            ) : selectedWall ? (\n              <>\n                <h2>Wall properties</h2>\n                <p>\n                  {selectedWall.origin === "cad-auto"\n                    ? "CAD-backed wall. Any edit becomes a manual reviewed correction."\n                    : "Editable parametric wall. Changes stay reviewable until accepted."}\n                </p>\n                <div className="property-grid">\n                  {field("Start X (m)", selectedWall.start[0], (x) =>\n                    patchSelectedWall({ start: [x, selectedWall.start[1]] }),\n                  )}\n                  {field("Start Z (m)", selectedWall.start[1], (z) =>\n                    patchSelectedWall({ start: [selectedWall.start[0], z] }),\n                  )}\n                  {field("End X (m)", selectedWall.end[0], (x) =>\n                    patchSelectedWall({ end: [x, selectedWall.end[1]] }),\n                  )}\n                  {field("End Z (m)", selectedWall.end[1], (z) =>\n                    patchSelectedWall({ end: [selectedWall.end[0], z] }),\n                  )}\n                  {field("Thickness (m)", selectedWall.thickness, (thickness) =>\n                    patchSelectedWall({ thickness }),\n                    0.01,\n                  )}\n                  {field("Height (m)", selectedWall.height, (height) =>\n                    patchSelectedWall({ height }),\n                  )}\n                </div>\n                <small>\n                  Length {wallLength(selectedWall).toFixed(2)} m · {selectedWall.roomIds.length} room link{selectedWall.roomIds.length === 1 ? "" : "s"}\n                </small>\n                <button\n                  className={selectedWall.reviewed ? "" : "primary"}\n                  disabled={selectedWall.reviewed}\n                  onClick={() => {\n                    try {\n                      architectureProject(\n                        setWallReviewed(p.scene, selectedWall.id, true),\n                        "Wall accepted as human-reviewed architecture.",\n                      );\n                    } catch (reason) {\n                      setError(reason instanceof Error ? reason.message : "Wall review failed.");\n                    }\n                  }}\n                >\n                  {selectedWall.reviewed ? "Reviewed" : "Accept wall"}\n                </button>\n                <button\n                  className="danger"\n                  onClick={() => {\n                    try {\n                      architectureProject(removeManualWall(p.scene, selectedWall.id));\n                      setSelected("");\n                      setMessage("Wall removed. Linked room review state was reset where needed.");\n                    } catch (reason) {\n                      setError(reason instanceof Error ? reason.message : "Wall removal failed.");\n                    }\n                  }}\n                >\n                  Remove wall\n                </button>\n              </>\n            ) : selectedOpening ? (\n              <>\n                <h2>{selectedOpening.kind === "window" ? "Window" : selectedOpening.kind === "door" ? "Door" : "Opening"} properties</h2>\n                <p>Move and scale with the gizmo, or enter exact wall-opening dimensions.</p>\n                <label>\n                  Opening type\n                  <select\n                    value={selectedOpening.kind}\n                    onChange={(event) =>\n                      patchSelectedOpening({ kind: event.target.value as Opening["kind"] })\n                    }\n                  >\n                    <option value="door">Door</option>\n                    <option value="window">Window</option>\n                    <option value="opening">Open passage</option>\n                  </select>\n                </label>\n                <div className="property-grid">\n                  {field("Position X (m)", selectedOpening.x, (x) =>\n                    moveSelectedOpening(x, selectedOpening.z),\n                  )}\n                  {field("Position Z (m)", selectedOpening.z, (z) =>\n                    moveSelectedOpening(selectedOpening.x, z),\n                  )}\n                  {field("Width (m)", selectedOpening.width, (width) =>\n                    patchSelectedOpening({ width }),\n                    0.05,\n                  )}\n                  {field("Height (m)", selectedOpening.height, (height) =>\n                    patchSelectedOpening({ height }),\n                    0.05,\n                  )}\n                  {selectedOpening.kind === "window" &&\n                    field("Sill height (m)", selectedOpening.sillHeight ?? 0.9, (sillHeight) =>\n                      patchSelectedOpening({ sillHeight }),\n                      0.05,\n                    )}\n                </div>\n                <small>\n                  {selectedOpening.roomIds.length} room link{selectedOpening.roomIds.length === 1 ? "" : "s"} · rotation {selectedOpening.rotationY.toFixed(1)}°\n                </small>\n                <button\n                  className={selectedOpening.reviewed ? "" : "primary"}\n                  disabled={selectedOpening.reviewed}\n                  onClick={() => {\n                    try {\n                      architectureProject(\n                        setOpeningReviewed(p.scene, selectedOpening.id, true),\n                        `${selectedOpening.kind} accepted as human-reviewed architecture.`,\n                      );\n                    } catch (reason) {\n                      setError(reason instanceof Error ? reason.message : "Opening review failed.");\n                    }\n                  }}\n                >\n                  {selectedOpening.reviewed ? "Reviewed" : "Accept opening"}\n                </button>\n                <button\n                  className="danger"\n                  onClick={() => {\n                    try {\n                      architectureProject(removeManualOpening(p.scene, selectedOpening.id));\n                      setSelected("");\n                      setMessage("Opening removed.");\n                    } catch (reason) {\n                      setError(reason instanceof Error ? reason.message : "Opening removal failed.");\n                    }\n                  }}\n                >\n                  Remove opening\n                </button>\n              </>\n            ) : siteElement ? (\n`,
  "Studio architecture inspector",
);

studio = replaceOne(
  studio,
  `          {(scene.siteElements?.length ?? 0) > 0 && (\n`,
  `          {((scene.walls?.length ?? 0) > 0 || (scene.openings?.length ?? 0) > 0) && (\n            <>\n              <div className="section-label">ARCHITECTURE</div>\n              <div className="room-tree site-element-tree">\n                {(scene.walls ?? [])\n                  .filter((entry) => !isolateFloorId || entry.floorId === isolateFloorId)\n                  .slice(0, 120)\n                  .map((entry) => (\n                    <button\n                      type="button"\n                      key={entry.id}\n                      className={selected === entry.id ? "tree-room active" : "tree-room"}\n                      onClick={() => select(entry.id)}\n                    >\n                      <span>{entry.reviewed ? "◉" : "○"} Wall</span>\n                      <small>{wallLength(entry).toFixed(2)} m · {entry.origin}</small>\n                    </button>\n                  ))}\n                {(scene.openings ?? [])\n                  .filter((entry) => !isolateFloorId || entry.floorId === isolateFloorId)\n                  .slice(0, 120)\n                  .map((entry) => (\n                    <button\n                      type="button"\n                      key={entry.id}\n                      className={selected === entry.id ? "tree-room active" : "tree-room"}\n                      onClick={() => select(entry.id)}\n                    >\n                      <span>{entry.reviewed ? "◉" : "○"} {entry.kind}</span>\n                      <small>{entry.width.toFixed(2)} × {entry.height.toFixed(2)} m</small>\n                    </button>\n                  ))}\n              </div>\n            </>\n          )}\n          {(scene.siteElements?.length ?? 0) > 0 && (\n`,
  "Studio architecture outliner",
);

studio = replaceOne(
  studio,
  `              setShowRoomMapper(true);\n              setShowReferenceWorkspace(false);\n`,
  `              setArchitectureTool("select");\n              setShowRoomMapper(true);\n              setShowReferenceWorkspace(false);\n`,
  "Studio room mapper cancels architecture tool",
);

fs.writeFileSync(studioPath, studio);

console.log("Phase 16 direct architectural editor integration applied.");

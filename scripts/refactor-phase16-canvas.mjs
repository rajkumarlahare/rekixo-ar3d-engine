import fs from "node:fs";

const path = "apps/admin/src/studio/SceneCanvas.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOne(needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1)
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(needle, replacement);
}

replaceOne(
  `import {\n  openingTransformChange,\n  renderArchitectureElements,\n  wallTransformChange,\n} from "./sceneCanvasArchitecture";\n`,
  `import {\n  createArchitectureCanvasController,\n  type ArchitectureCanvasProps,\n} from "./sceneCanvasArchitectureController";\n`,
  "architecture controller import",
);

replaceOne(
  `export interface RoomDrawResult {\n  x: number;\n  z: number;\n  width: number;\n  depth: number;\n}\nexport interface WallDrawResult {\n  floorId: string;\n  start: RoomPoint;\n  end: RoomPoint;\n}\nexport interface OpeningPlacementResult {\n  floorId: string;\n  point: RoomPoint;\n}\n`,
  `export interface RoomDrawResult {\n  x: number;\n  z: number;\n  width: number;\n  depth: number;\n}\n`,
  "architecture result type extraction",
);

replaceOne(`interface Props {\n`, `interface Props extends ArchitectureCanvasProps {\n`, "architecture props extension");

replaceOne(
  `  architectureEditing?: boolean;\n  wallDraw?: {\n    enabled: boolean;\n    floorId: string;\n    snap: boolean;\n  };\n  openingPlacement?: {\n    enabled: boolean;\n    floorId: string;\n    snap: boolean;\n  };\n  onWallDraw?: (result: WallDrawResult) => void;\n  onOpeningPlace?: (result: OpeningPlacementResult) => void;\n`,
  ``,
  "architecture props extraction",
);

replaceOne(
  `    const model = new T.Group(),\n      rooms = new T.Group(),\n      site = new T.Group(),\n      architecture = new T.Group(),\n      references = new T.Group();\n    site.name = "Studio site and landscape";\n    architecture.name = "Studio editable architecture";\n`,
  `    const model = new T.Group(),\n      rooms = new T.Group(),\n      site = new T.Group(),\n      references = new T.Group();\n    site.name = "Studio site and landscape";\n    const architectureController = createArchitectureCanvasController({\n      getConfig: () => latest.current,\n      renderer,\n      controls,\n      pointOnFloor: (x, y, floorId, snap) => pointOnFloor(x, y, floorId, snap),\n      setStatus,\n    });\n    const architecture = architectureController.group;\n`,
  "architecture controller init",
);

replaceOne(
  `    roomDraft.visible = false;\n    roomDraft.renderOrder = 30;\n    const wallDraft = new T.Mesh(\n      new T.BoxGeometry(1, 0.07, 0.09),\n      new T.MeshBasicMaterial({\n        color: 0xffb45e,\n        transparent: true,\n        opacity: 0.8,\n        depthWrite: false,\n      }),\n    );\n    wallDraft.visible = false;\n    wallDraft.renderOrder = 33;\n    const polygonDraft = new T.Group();\n`,
  `    roomDraft.visible = false;\n    roomDraft.renderOrder = 30;\n    const wallDraft = architectureController.wallDraft;\n    const polygonDraft = new T.Group();\n`,
  "wall draft extraction",
);

replaceOne(
  `      const selectedWall = current.scene.walls?.find(\n        (candidate) => candidate.id === current.selected,\n      );\n      if (selectedWall) {\n        current.onTransformCommit(\n          wallTransformChange(\n            selectedWall,\n            target,\n            current.transformMode ?? "translate",\n          ),\n        );\n        return;\n      }\n      const selectedOpening = current.scene.openings?.find(\n        (candidate) => candidate.id === current.selected,\n      );\n      if (selectedOpening) {\n        const change = openingTransformChange(\n          selectedOpening,\n          target,\n          current.transformMode ?? "translate",\n        );\n        if (change) current.onTransformCommit(change);\n        return;\n      }\n`,
  `      if (architectureController.commitTransform(target)) return;\n`,
  "architecture transform extraction",
);

replaceOne(
  `    let roomDrawStart: T.Vector3 | undefined;\n    let wallDrawStart: T.Vector3 | undefined;\n    let roomStampCenter: T.Vector3 | undefined;\n`,
  `    let roomDrawStart: T.Vector3 | undefined;\n    let roomStampCenter: T.Vector3 | undefined;\n`,
  "wall draw state extraction",
);

replaceOne(
  `      for (const wall of latest.current.scene.walls ?? []) {\n        if (wall.floorId !== floorId) continue;\n        segments.push({\n          id: \`wall:${"${wall.id}"}\`,\n          start: wall.start,\n          end: wall.end,\n        });\n      }\n`,
  `      architectureController.addSnapSegments(floorId, segments);\n`,
  "architecture snap extraction",
);

replaceOne(
  `    const architecturePlanePoint = (event: PointerEvent) => {\n      const config = latest.current.wallDraw?.enabled\n        ? latest.current.wallDraw\n        : latest.current.openingPlacement?.enabled\n          ? latest.current.openingPlacement\n          : undefined;\n      if (!config?.enabled || !config.floorId) return undefined;\n      return pointOnFloor(\n        event.clientX,\n        event.clientY,\n        config.floorId,\n        config.snap,\n      );\n    };\n\n`,
  ``,
  "architecture plane extraction",
);

replaceOne(
  `      if (\n        e.button === 0 &&\n        latest.current.wallDraw?.enabled &&\n        latest.current.view === "building"\n      ) {\n        const start = architecturePlanePoint(e);\n        if (start) {\n          wallDrawStart = start;\n          wallDraft.visible = false;\n          controls.enabled = false;\n          renderer.domElement.setPointerCapture(e.pointerId);\n          point = {\n            x: e.clientX,\n            y: e.clientY,\n            ox: e.clientX,\n            oy: e.clientY,\n            id: e.pointerId,\n          };\n          setStatus("Drag to draw the wall · release to place");\n          return;\n        }\n      }\n      if (\n        e.button === 0 &&\n        latest.current.openingPlacement?.enabled &&\n        latest.current.view === "building"\n      ) {\n        renderer.domElement.setPointerCapture(e.pointerId);\n        point = {\n          x: e.clientX,\n          y: e.clientY,\n          ox: e.clientX,\n          oy: e.clientY,\n          id: e.pointerId,\n        };\n        return;\n      }\n`,
  `      if (architectureController.pointerDown(e)) return;\n`,
  "architecture pointer down extraction",
);

replaceOne(
  `      if (wallDrawStart && latest.current.wallDraw?.enabled) {\n        const end = architecturePlanePoint(e);\n        if (end) {\n          const dx = end.x - wallDrawStart.x;\n          const dz = end.z - wallDrawStart.z;\n          const length = Math.max(0.01, Math.hypot(dx, dz));\n          wallDraft.position.set(\n            (end.x + wallDrawStart.x) / 2,\n            wallDrawStart.y + 0.05,\n            (end.z + wallDrawStart.z) / 2,\n          );\n          wallDraft.rotation.y = Math.atan2(-dz, dx);\n          wallDraft.scale.set(length, 1, 1);\n          wallDraft.visible = true;\n        }\n        return;\n      }\n`,
  `      if (architectureController.pointerMove(e)) return;\n`,
  "architecture pointer move extraction",
);

replaceOne(
  `      if (wallDrawStart) {\n        const start = wallDrawStart;\n        const end = architecturePlanePoint(e);\n        const floorId = latest.current.wallDraw?.floorId;\n        wallDrawStart = undefined;\n        wallDraft.visible = false;\n        point = undefined;\n        controls.enabled = latest.current.view !== "walk";\n        try {\n          renderer.domElement.releasePointerCapture(e.pointerId);\n        } catch {}\n        if (end && floorId) {\n          const length = Math.hypot(end.x - start.x, end.z - start.z);\n          if (length >= 0.2) {\n            latest.current.onWallDraw?.({\n              floorId,\n              start: [Number(start.x.toFixed(4)), Number(start.z.toFixed(4))],\n              end: [Number(end.x.toFixed(4)), Number(end.z.toFixed(4))],\n            });\n            setStatus("");\n          } else {\n            setStatus("Draw a wall at least 0.2 m long.");\n          }\n        }\n        return;\n      }\n      if (latest.current.openingPlacement?.enabled) {\n        if (!point) return;\n        const small = isPointerTap(\n          { clientX: point.ox, clientY: point.oy },\n          e,\n        );\n        point = undefined;\n        controls.enabled = latest.current.view !== "walk";\n        try {\n          renderer.domElement.releasePointerCapture(e.pointerId);\n        } catch {}\n        if (!small) return;\n        const target = architecturePlanePoint(e);\n        const floorId = latest.current.openingPlacement.floorId;\n        if (target && floorId)\n          latest.current.onOpeningPlace?.({\n            floorId,\n            point: [Number(target.x.toFixed(4)), Number(target.z.toFixed(4))],\n          });\n        return;\n      }\n`,
  `      if (architectureController.pointerUp(e)) return;\n`,
  "architecture pointer up extraction",
);

replaceOne(
  `    r.architecture.visible =\n      props.view === "building" && Boolean(props.architectureEditing);\n`,
  ``,
  "architecture visibility extraction",
);

replaceOne(
  `    renderArchitectureElements(\n      r.architecture,\n      props.scene,\n      props.selected,\n      r.selectables,\n      {\n        visible: props.view === "building" && Boolean(props.architectureEditing),\n        floorId: props.isolateFloorId,\n      },\n    );\n`,
  `    architectureController.render(r.selectables, props.isolateFloorId);\n`,
  "architecture rendering extraction",
);

replaceOne(
  `    const isArchitectureWall = Boolean(\n      props.scene.walls?.some((wall) => wall.id === props.selected),\n    );\n    const isArchitectureOpening = Boolean(\n      props.scene.openings?.some((opening) => opening.id === props.selected),\n    );\n`,
  `    const architectureSelection = architectureController.selectionKind();\n    const isArchitectureWall = architectureSelection === "wall";\n    const isArchitectureOpening = architectureSelection === "opening";\n`,
  "architecture selection extraction",
);

replaceOne(
  `  const authoringActive = Boolean(\n    props.wallDraw?.enabled ||\n      props.openingPlacement?.enabled ||\n      props.roomDraw?.enabled ||\n      props.roomStamp?.enabled ||\n      props.roomPolygonDraw?.enabled ||\n      props.furniturePlacement?.enabled,\n  );\n`,
  `  const authoringActive = Boolean(\n    architectureController.authoringActive() ||\n      props.roomDraw?.enabled || props.roomStamp?.enabled ||\n      props.roomPolygonDraw?.enabled || props.furniturePlacement?.enabled,\n  );\n`,
  "architecture authoring extraction",
);

fs.writeFileSync(path, source);
const lines = source.split("\n").length;
console.log(`Extracted Phase 16 canvas architecture controller · ${lines} lines.`);

import fs from "node:fs";

const path = "apps/admin/src/studio/Studio.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOne(needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1)
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(needle, replacement);
}

function replaceRange(startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${label}: end marker missing`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceOne(
  `} from "./architectureAuthoring";\nimport * as storage from "./storage";`,
  `} from "./architectureAuthoring";\nimport {\n  ArchitectureInspector,\n  ArchitectureOutliner,\n  ArchitectureToolbar,\n} from "./ArchitectureEditingPanels";\nimport * as storage from "./storage";`,
  "architecture editing panel imports",
);

replaceRange(
  `            {view === "building" && (\n              <div className="editor-mode-switch" role="group" aria-label="Architecture tools">`,
  `\n\n            {view === "rooms" && room && (`,
  `            {view === "building" && (\n              <ArchitectureToolbar\n                floors={scene.floors}\n                activeFloorId={activeArchitectureFloorId}\n                tool={architectureTool}\n                disabled={Boolean(review) || busy}\n                onToolChange={startArchitectureTool}\n                onFloorChange={(floorId) => {\n                  setArchitectureFloorId(floorId);\n                  setIsolateFloorId(floorId);\n                  const target = scene.floors.find((entry) => entry.id === floorId);\n                  if (target) setSectionCutOffset(target.elevation + 1.5);\n                }}\n              />\n            )}`,
  "architecture toolbar extraction",
);

replaceRange(
  `            ) : selectedWall ? (`,
  `            ) : siteElement ? (`,
  `            ) : selectedWall || selectedOpening ? (\n              <ArchitectureInspector\n                wall={selectedWall}\n                opening={selectedOpening}\n                onPatchWall={patchSelectedWall}\n                onPatchOpening={patchSelectedOpening}\n                onMoveOpening={moveSelectedOpening}\n                onAcceptWall={() =>\n                  architectureProject(\n                    setWallReviewed(p.scene, selectedWall!.id, true),\n                    "Wall accepted as human-reviewed architecture.",\n                  )\n                }\n                onRemoveWall={() => {\n                  try {\n                    architectureProject(removeManualWall(p.scene, selectedWall!.id));\n                    setSelected("");\n                    setMessage("Wall removed. Linked room review state was reset where needed.");\n                  } catch (reason) {\n                    setError(reason instanceof Error ? reason.message : "Wall removal failed.");\n                  }\n                }}\n                onAcceptOpening={() =>\n                  architectureProject(\n                    setOpeningReviewed(p.scene, selectedOpening!.id, true),\n                    selectedOpening!.kind + " accepted as human-reviewed architecture.",\n                  )\n                }\n                onRemoveOpening={() => {\n                  architectureProject(removeManualOpening(p.scene, selectedOpening!.id));\n                  setSelected("");\n                  setMessage("Opening removed.");\n                }}\n              />\n`,
  "architecture inspector extraction",
);

replaceRange(
  `          {((scene.walls?.length ?? 0) > 0 || (scene.openings?.length ?? 0) > 0) && (`,
  `          {(scene.siteElements?.length ?? 0) > 0 && (`,
  `          <ArchitectureOutliner\n            walls={scene.walls ?? []}\n            openings={scene.openings ?? []}\n            floorId={isolateFloorId}\n            selected={selected}\n            onSelect={select}\n          />\n`,
  "architecture outliner extraction",
);

fs.writeFileSync(path, source);
console.log("Extracted Phase 16 architecture panels from Studio.");

import fs from "node:fs";

const path = "scripts/apply-phase16-direct-editing.mjs";
let source = fs.readFileSync(path, "utf8");

const replacements = [
  [
    '        `Wall created · ${wallLength(built.wall).toFixed(2)} m · ${built.wall.roomIds.length} room link${built.wall.roomIds.length === 1 ? "" : "s"}.`,\\n',
    '        "Wall created · " + wallLength(built.wall).toFixed(2) + " m · " + built.wall.roomIds.length + " room link" + (built.wall.roomIds.length === 1 ? "" : "s") + ".",\\n',
  ],
  [
    '        `${built.opening.kind === "window" ? "Window" : "Door"} placed on wall · review dimensions, then accept it.`,\\n',
    '        (built.opening.kind === "window" ? "Window" : "Door") + " placed on wall · review dimensions, then accept it.",\\n',
  ],
  [
    '                        `${selectedOpening.kind} accepted as human-reviewed architecture.`,\\n',
    '                        selectedOpening.kind + " accepted as human-reviewed architecture.",\\n',
  ],
];

for (const [needle, replacement] of replacements) {
  const count = source.split(needle).length - 1;
  if (count !== 1)
    throw new Error(`Expected one script literal match, found ${count}: ${needle.slice(0, 64)}`);
  source = source.replace(needle, replacement);
}

fs.writeFileSync(path, source);
console.log("Repaired Phase 16 integration script literals.");

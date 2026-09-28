import runtime from "../../../../project-profiles/reference-source-v9/runtime.json";

if (
  typeof runtime.sourceModelSha256 !== "string" ||
  !/^[a-f0-9]{64}$/i.test(runtime.sourceModelSha256) ||
  !Array.isArray(runtime.floorLevelsM) ||
  runtime.floorLevelsM.length < 2 ||
  !runtime.floorLevelsM.every(
    (item) => typeof item === "number" && Number.isFinite(item),
  )
)
  throw Error("Reference source runtime profile is invalid.");

export const JYOTI_SOURCE_MODEL_SHA256 = runtime.sourceModelSha256;
export const JYOTI_SOURCE_FLOOR_LEVELS_M = [...runtime.floorLevelsM];

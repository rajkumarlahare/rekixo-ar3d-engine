const BINDING_FORMAT = "rekixo-reviewed-component-bindings";
const BINDING_VERSION = 1;
const MAX_BINDINGS = 5000;
const SEMANTICS = new Set(["wall", "door", "window", "opening", "ignore"]);

function nodeIdentity(value) {
  if (typeof value !== "string") return null;
  const match = /^node:([a-f0-9]{64}):(0|[1-9][0-9]{0,8})$/i.exec(value);
  if (!match) return null;
  const index = Number(match[2]);
  return Number.isSafeInteger(index)
    ? { sha256: match[1].toLowerCase(), index }
    : null;
}

function storedBindingTargetError(draft, block) {
  if (
    !block ||
    block.format !== BINDING_FORMAT ||
    block.version !== BINDING_VERSION
  )
    return "Reviewed component bindings metadata is invalid.";
  if (
    !Array.isArray(block.bindings) ||
    block.bindings.length < 1 ||
    block.bindings.length > MAX_BINDINGS
  )
    return "Reviewed component bindings list is invalid.";

  const floors = new Set((draft?.scene?.floors || []).map((floor) => floor?.id));
  const rooms = new Map(
    (draft?.scene?.rooms || []).map((room) => [room?.id, room]),
  );
  const seen = new Set();
  for (const binding of block.bindings) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding))
      return "Reviewed component binding is invalid.";
    if (!nodeIdentity(binding.nodeId) || seen.has(binding.nodeId))
      return "Reviewed component node identity is invalid or duplicated.";
    seen.add(binding.nodeId);
    if (binding.floorId !== undefined && !floors.has(binding.floorId))
      return "Reviewed component binding references a missing floor.";
    if (
      binding.unit !== undefined &&
      (typeof binding.unit !== "string" ||
        !binding.unit.trim() ||
        binding.unit.length > 120)
    )
      return "Reviewed component binding unit is invalid.";
    if (binding.semantic !== undefined && !SEMANTICS.has(binding.semantic))
      return "Reviewed component binding semantic is invalid.";
    if (
      binding.floorId === undefined &&
      binding.unit === undefined &&
      binding.roomId === undefined &&
      binding.semantic === undefined
    )
      return "Reviewed component binding must assign at least one semantic target.";

    if (binding.roomId !== undefined) {
      const room = rooms.get(binding.roomId);
      if (!room)
        return "Reviewed component binding references a missing room.";
      if (binding.floorId !== undefined && room.floorId !== binding.floorId)
        return "Reviewed component binding room/floor identity is inconsistent.";
      if (
        binding.unit !== undefined &&
        String(room.unit || "").trim() !== binding.unit.trim()
      )
        return "Reviewed component binding room/unit identity is inconsistent.";
    } else if (binding.unit !== undefined) {
      const unit = binding.unit.trim();
      const unitExists = [...rooms.values()].some(
        (room) =>
          String(room?.unit || "").trim() === unit &&
          (binding.floorId === undefined || room?.floorId === binding.floorId),
      );
      if (!unitExists)
        return "Reviewed component binding unit does not exist in the current draft.";
    }
  }
  return null;
}

export function validateStoredBindingTargets(draft, block) {
  const error = storedBindingTargetError(draft, block);
  if (error) throw Error(error);
  return block;
}

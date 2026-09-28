import {
  SCENE_MANIFEST_FORMAT,
  SCENE_MANIFEST_VERSION,
  assertSceneManifestV2,
  type SceneManifestV2,
  type SceneUnitV2,
} from "@rekixo/3d-contracts";
import {
  projectSlug,
  type Asset,
  type Project,
  type Room,
} from "./domain";

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function unitKey(room: Room) {
  return `${room.floorId}\u0000${room.unit.trim()}`;
}

export function buildSceneManifestV2(
  project: Project,
  files: Asset[],
): SceneManifestV2 {
  const fileById = new Map(files.map((file) => [file.id, file]));
  for (const assetId of project.assets) {
    const file = fileById.get(assetId);
    if (!file || file.projectId !== project.id)
      throw Error("Scene manifest export requires every project asset.");
  }

  const siteId = `site:${project.id}:primary`;
  const buildingId = `building:${project.id}:primary`;
  const modelId = project.scene.modelId
    ? `model:${project.scene.modelId}`
    : undefined;

  const unitEntries = Array.from(
    new Map(
      project.scene.rooms.map((room) => [
        unitKey(room),
        { floorId: room.floorId, name: room.unit.trim() },
      ]),
    ).entries(),
  ).sort(([left], [right]) => left.localeCompare(right));

  const usedUnitIds = new Set<string>();
  const unitIdByKey = new Map<string, string>();
  const units: SceneUnitV2[] = unitEntries.map(([key, unit], index) => {
    const base = `unit:${stableHash(key)}`;
    let id = base;
    let suffix = 1;
    while (usedUnitIds.has(id)) {
      id = `${base}:${suffix}`;
      suffix += 1;
    }
    usedUnitIds.add(id);
    unitIdByKey.set(key, id);
    return {
      id,
      floorId: unit.floorId,
      name: unit.name || `Unit ${index + 1}`,
    };
  });

  const manifest: SceneManifestV2 = {
    format: SCENE_MANIFEST_FORMAT,
    version: SCENE_MANIFEST_VERSION,
    project: {
      id: project.id,
      slug: projectSlug(project),
      name: project.name,
    },
    coordinateSystem: {
      linearUnit: "metre",
      upAxis: "Y",
      handedness: "right",
      modelScaleToMetres: project.scene.scale,
    },
    assets: project.assets.map((assetId) => {
      const file = fileById.get(assetId)!;
      return {
        id: file.id,
        name: file.name,
        mimeType: file.type,
        byteSize: file.size,
        sha256: file.hash,
        role: file.id === project.scene.modelId ? "model" : "reference",
      };
    }),
    models:
      project.scene.modelId && modelId
        ? [
            {
              id: modelId,
              assetId: project.scene.modelId,
              role: "shell",
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
              },
            },
          ]
        : [],
    sites: [{ id: siteId, name: project.name }],
    buildings: [{ id: buildingId, siteId, name: project.name }],
    floors: project.scene.floors.map((floor) => ({
      id: floor.id,
      buildingId,
      name: floor.name,
      elevationM: floor.elevation,
    })),
    units,
    rooms: project.scene.rooms.map((room) => ({
      id: room.id,
      floorId: room.floorId,
      unitId: unitIdByKey.get(unitKey(room)),
      name: room.name,
      boundary: {
        kind: "rectangle",
        center: [room.x, room.z],
        size: [room.width, room.depth],
      },
      ceilingHeightM: room.height,
      evidence: {
        status: room.verified ? "reviewed" : "unverified",
        ...(room.source.trim() ? { sourceNote: room.source.trim() } : {}),
      },
      meshBindings:
        room.mesh && modelId
          ? [
              {
                modelId,
                strategy: "source-node-name",
                key: room.mesh,
              },
            ]
          : [],
      finish: { color: room.color },
    })),
    openings: [],
    furniture: project.scene.furniture.map((item) => {
      const room = project.scene.rooms.find((candidate) => candidate.id === item.roomId);
      const floor = project.scene.floors.find(
        (candidate) => candidate.id === room?.floorId,
      );
      if (!room || !floor)
        throw Error("Furniture has an invalid room or floor reference.");
      return {
        id: item.id,
        roomId: item.roomId,
        catalogKey: item.kind,
        transform: {
          position: [room.x + item.x, floor.elevation, room.z + item.z],
          rotation: [0, (item.rotation * Math.PI) / 180, 0],
          scale: [1, 1, 1],
        },
        finish: { color: item.color },
      };
    }),
    materials: [],
    cameras: [],
  };

  assertSceneManifestV2(manifest);
  return manifest;
}

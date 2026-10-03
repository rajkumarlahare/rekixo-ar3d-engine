import {
  SCENE_MANIFEST_FORMAT,
  SCENE_MANIFEST_VERSION,
  assertSceneManifestV2,
  type SceneCatalogItemV2,
  type SceneManifestV2,
  type SceneSurfaceV2,
  type SceneUnitV2,
} from "@rekixo/3d-contracts";
import {
  catalog,
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

function roomBoundary(room: Room): Array<[number, number]> {
  if (room.polygon?.length)
    return room.polygon.map(([x, z]) => [x, z] as [number, number]);
  return [
    [room.x - room.width / 2, room.z - room.depth / 2],
    [room.x + room.width / 2, room.z - room.depth / 2],
    [room.x + room.width / 2, room.z + room.depth / 2],
    [room.x - room.width / 2, room.z + room.depth / 2],
  ];
}

function roomSemanticSurfaces(room: Room): SceneSurfaceV2[] {
  const edges = roomBoundary(room);
  return [
    {
      id: `surface:${room.id}:floor`,
      roomId: room.id,
      kind: "floor",
      finish: { color: room.color },
    },
    {
      id: `surface:${room.id}:ceiling`,
      roomId: room.id,
      kind: "ceiling",
    },
    ...edges.map(
      (_, edgeIndex): SceneSurfaceV2 => ({
        id: `surface:${room.id}:wall:${edgeIndex}`,
        roomId: room.id,
        kind: "wall",
        edgeIndex,
      }),
    ),
  ];
}

function legacyCatalogItems(): SceneCatalogItemV2[] {
  return Object.entries(catalog).map(([key, item]) => ({
    id: key,
    name: item.name,
    category: key,
    source: "procedural",
    dimensionsM: [item.width, item.height, item.depth],
    anchor: "floor-center",
    collisionFootprintM: [item.width, item.depth],
    styleTags: ["legacy-procedural"],
    materialSlots: ["primary"],
  }));
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
                position: [
                  project.scene.modelTransform?.x ?? 0,
                  project.scene.modelTransform?.y ?? 0,
                  project.scene.modelTransform?.z ?? 0,
                ],
                rotation: [
                  0,
                  ((project.scene.modelTransform?.rotationY ?? 0) * Math.PI) / 180,
                  0,
                ],
                scale: [1, 1, 1],
              },
            },
          ]
        : [],
    sites: [{ id: siteId, name: project.name }],
    siteElements: (project.scene.siteElements ?? [])
      .filter((item) => item.reviewed)
      .map((item) => ({
        id: item.id,
        siteId,
        kind: item.kind,
        transform: {
          position: [item.x, item.y ?? 0, item.z] as [number, number, number],
          rotation: [
            0,
            (item.rotation * Math.PI) / 180,
            0,
          ] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        },
        dimensionsM: [
          item.width,
          item.height,
          item.depth,
        ] as [number, number, number],
        ...(item.shape ? { shape: item.shape } : {}),
        finish: { color: item.color },
        evidence: {
          status: "reviewed" as const,
          ...(item.sourceAssetId
            ? { sourceAssetId: item.sourceAssetId }
            : {}),
          ...(item.sourceRef
            ? { basis: item.sourceRef }
            : {}),
          sourceNote:
            item.origin === "model-cad-auto"
              ? "Human-reviewed structural envelope corroborated by CAD footprint and named 3D model geometry."
              : item.origin === "cad-auto"
                ? "Human-reviewed site geometry derived from CAD evidence."
                : "Human-reviewed site or structural geometry edited in Rekixo Studio.",
        },
      })),
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
      boundary: room.polygon?.length
        ? {
            kind: "polygon" as const,
            points: room.polygon.map(
              (point) => [point[0], point[1]] as [number, number],
            ),
          }
        : {
            kind: "rectangle" as const,
            center: [room.x, room.z] as [number, number],
            size: [room.width, room.depth] as [number, number],
          },
      ceilingHeightM: room.height,
      evidence: {
        status: room.verified ? "reviewed" : "unverified",
        ...(room.source.trim() ? { sourceNote: room.source.trim() } : {}),
        ...(room.sourceAssetId
          ? { sourceAssetId: room.sourceAssetId }
          : {}),
        ...(room.sourcePackSourceId
          ? { sourcePackSourceId: room.sourcePackSourceId }
          : {}),
        ...(room.sourceClaimIds?.length
          ? { sourceClaimIds: [...room.sourceClaimIds] }
          : {}),
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
    surfaces: project.scene.rooms.flatMap(roomSemanticSurfaces),
    catalogItems: legacyCatalogItems(),
    openings: (project.scene.openings ?? [])
      .filter((opening) => opening.reviewed)
      .map((opening) => ({
        id: opening.id,
        floorId: opening.floorId,
        kind: opening.kind,
        roomIds: [...opening.roomIds],
        position: [opening.x, opening.y, opening.z],
        widthM: opening.width,
        heightM: opening.height,
        ...(opening.sillHeight !== undefined
          ? { sillHeightM: opening.sillHeight }
          : {}),
      })),
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

import type { Asset, Project } from "./domain";
import type { SourceFusionReport } from "./sourceFusion";

export interface SourcePackRoleStatus {
  key: "model" | "cad" | "sketchup" | "drawing" | "visual" | "metadata";
  label: string;
  present: boolean;
  files: string[];
}

export interface SourcePackReadiness {
  roles: SourcePackRoleStatus[];
  completeSupportPack: boolean;
  autoBuildReady: boolean;
  blockingIssues: string[];
  reviewIssues: string[];
  summary: string;
}

function roleFiles(files: readonly Asset[], pattern: RegExp) {
  return files.filter((file) => pattern.test(file.name)).map((file) => file.name);
}

export function evaluateSourcePackReadiness(
  project: Project,
  files: readonly Asset[],
  fusion?: SourceFusionReport,
): SourcePackReadiness {
  const fusedNames = (kind: string) =>
    (fusion?.items ?? [])
      .filter((item) => item.kind === kind)
      .map((item) => item.name);
  const roleSource = (kind: string, fallback: RegExp) =>
    fusion ? fusedNames(kind) : roleFiles(files, fallback);

  const role = (
    key: SourcePackRoleStatus["key"],
    label: string,
    sourceFiles: string[],
  ): SourcePackRoleStatus => ({
    key,
    label,
    files: sourceFiles,
    present: sourceFiles.length > 0,
  });

  const roles: SourcePackRoleStatus[] = [
    role(
      "model",
      "3D model",
      fusion
        ? [...fusedNames("authoring-model"), ...fusedNames("web-model")]
        : roleFiles(files, /\.(?:fbx|glb)$/i),
    ),
    role("cad", "CAD", roleSource("cad", /\.(?:dwg|dxf)$/i)),
    role(
      "sketchup",
      "SketchUp",
      roleSource("sketchup", /\.(?:skp|skb)$/i),
    ),
    role("drawing", "Drawing/PDF", roleSource("drawing", /\.pdf$/i)),
    role(
      "visual",
      "Visual reference",
      roleSource(
        "visual-reference",
        /\.(?:png|jpe?g|webp|tiff?)$/i,
      ),
    ),
    role(
      "metadata",
      "Render metadata",
      roleSource("metadata", /\.(?:drs|json)$/i),
    ),
  ];

  const blockingIssues: string[] = [];
  const reviewIssues: string[] = [];

  const modelRole = roles.find((role) => role.key === "model")!;
  if (!modelRole.present) {
    blockingIssues.push(
      "Attach an FBX or GLB source model before automatic building.",
    );
  } else {
    const selected = project.scene.modelId
      ? files.find((file) => file.id === project.scene.modelId)
      : undefined;
    const selectedModel =
      selected && /\.(?:fbx|glb)$/i.test(selected.name) ? selected : undefined;
    if (modelRole.files.length > 1 && !selectedModel)
      blockingIssues.push(
        "Multiple 3D models are attached. Select the authoring model once.",
      );
  }

  const cad = roles.find((role) => role.key === "cad")!;
  if (!cad.present)
    reviewIssues.push(
      "No CAD source is attached; wall dimensions will rely on model/manual review.",
    );

  const sketchup = roles.find((role) => role.key === "sketchup")!;
  if (!sketchup.present)
    reviewIssues.push(
      "No SketchUp source is attached; material recovery may depend on FBX/visual references.",
    );

  const drawing = roles.find((role) => role.key === "drawing")!;
  if (!drawing.present)
    reviewIssues.push(
      "No PDF drawing is attached; plan alignment and room labels may need manual review.",
    );

  const visual = roles.find((role) => role.key === "visual")!;
  if (!visual.present)
    reviewIssues.push(
      "No exterior visual reference is attached; facade finish review will be limited.",
    );

  const metadata = roles.find((role) => role.key === "metadata")!;
  if (!metadata.present)
    reviewIssues.push(
      "No render metadata source is attached; external resource linkage may be incomplete.",
    );

  for (const conflict of fusion?.conflicts ?? []) {
    if (conflict.kind === "ambiguous-source")
      blockingIssues.push(conflict.message);
    else reviewIssues.push(conflict.message);
  }

  for (const item of fusion?.items ?? []) {
    if (item.extension === "dwg" && item.support === "needs-conversion")
      reviewIssues.push(
        "DWG is preserved and inspected, but editable AEC geometry still requires the controlled CAD provider.",
      );
    if (
      (item.extension === "skb" || item.extension === "skp") &&
      item.support === "needs-conversion"
    )
      reviewIssues.push(
        "SketchUp archive textures can be recovered now; native component geometry remains provider-assisted.",
      );
  }

  const completeSupportPack = roles.every((role) => role.present);
  const autoBuildReady = modelRole.present && blockingIssues.length === 0;
  const presentCount = roles.filter((role) => role.present).length;

  return {
    roles,
    completeSupportPack,
    autoBuildReady,
    blockingIssues: [...new Set(blockingIssues)],
    reviewIssues: [...new Set(reviewIssues)],
    summary: completeSupportPack
      ? "Complete six-role source pack attached."
      : `${presentCount}/${roles.length} source roles attached.`,
  };
}

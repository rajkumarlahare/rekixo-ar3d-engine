export const SOURCE_CLASSIFIER_VERSION = "source-classifier-v1";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "tif", "tiff"]);
const TEXTURE_HINT = /(?:^|[._\-\s/])(albedo|basecolou?r|diffuse|normal|roughness|metallic|metalness|occlusion|ambientocclusion|ao|emissive|opacity|alpha|bump|displacement|height|texture|tex)(?:[._\-\s/]|$)/i;

function extensionOf(filename) {
  const clean = String(filename || "").trim().toLowerCase();
  const leaf = clean.split("/").pop() || clean;
  const dot = leaf.lastIndexOf(".");
  return dot > 0 && dot < leaf.length - 1 ? leaf.slice(dot + 1) : "";
}

function result(roles, capabilities, confidence, geometryAuthorityScore, rationaleCode) {
  return {
    classifierVersion: SOURCE_CLASSIFIER_VERSION,
    roles: [...new Set(roles)],
    capabilities: [...new Set(capabilities)],
    confidence,
    geometryAuthorityScore,
    rationaleCode,
  };
}

export function classifySourceMetadata({ filename, mediaType = "" }) {
  const ext = extensionOf(filename);
  const name = String(filename || "").toLowerCase();
  const type = String(mediaType || "").toLowerCase();

  if (ext === "glb")
    return result(
      ["geometry-authority", "material-recovery"],
      ["geometry", "materials", "textures"],
      0.99,
      0.99,
      "web-model-glb",
    );
  if (ext === "gltf")
    return result(
      ["geometry-authority", "material-recovery"],
      ["geometry", "materials", "textures"],
      0.98,
      0.98,
      "web-model-gltf",
    );
  if (ext === "fbx")
    return result(
      ["geometry-authority", "material-recovery"],
      ["geometry", "materials", "textures"],
      0.97,
      0.96,
      "finished-model-fbx",
    );

  if (ext === "skp" || ext === "skb")
    return result(
      ["material-recovery", "evidence"],
      ["geometry", "materials", "textures", "authoring-history"],
      ext === "skp" ? 0.88 : 0.82,
      ext === "skp" ? 0.72 : 0.55,
      ext === "skp" ? "sketchup-authoring-source" : "sketchup-backup-source",
    );

  if (ext === "dwg" || ext === "dxf")
    return result(
      ["evidence"],
      ["dimensions", "floor-plan"],
      0.97,
      0,
      "cad-evidence",
    );

  if (ext === "drs")
    return result(
      ["material-recovery", "evidence"],
      ["materials", "render-dependencies"],
      0.88,
      0,
      "render-dependency-metadata",
    );

  if (ext === "pdf" || type === "application/pdf")
    return result(
      ["content-reference", "evidence"],
      ["floor-plan", "marketing", "location-context"],
      0.92,
      0,
      "project-document-pdf",
    );

  if (ext === "hdr" || ext === "exr")
    return result(
      ["presentation-reference", "material-recovery"],
      ["visual-style", "textures"],
      0.9,
      0,
      "lighting-environment-image",
    );

  if (ext === "mtl")
    return result(
      ["material-recovery"],
      ["materials", "textures"],
      0.9,
      0,
      "material-library",
    );

  if (IMAGE_EXTENSIONS.has(ext) || type.startsWith("image/")) {
    if (TEXTURE_HINT.test(name))
      return result(
        ["material-recovery"],
        ["materials", "textures"],
        0.86,
        0,
        "texture-image",
      );
    return result(
      ["presentation-reference"],
      ["visual-style"],
      0.92,
      0,
      "visual-reference-image",
    );
  }

  if (["obj", "dae", "3ds", "stl", "blend"].includes(ext))
    return result(
      ["evidence"],
      ["geometry"],
      0.7,
      0.65,
      "secondary-geometry-format",
    );

  return result(["evidence"], [], 0.35, 0, "unknown-conservative-evidence");
}

export function chooseGeometryAuthoritySuggestion(items) {
  const ranked = [...items]
    .filter((item) => Number(item.geometryAuthorityScore) > 0)
    .sort((a, b) => {
      const byScore = Number(b.geometryAuthorityScore) - Number(a.geometryAuthorityScore);
      if (byScore !== 0) return byScore;
      return String(a.sourceFileId).localeCompare(String(b.sourceFileId));
    });

  if (!ranked.length || Number(ranked[0].geometryAuthorityScore) < 0.85)
    return {
      status: "operator-review-required",
      sourceFileId: null,
      reason: "no-high-confidence-geometry-candidate",
    };

  const top = ranked[0];
  const second = ranked[1];
  if (
    second &&
    Number(second.geometryAuthorityScore) >= 0.85 &&
    Number(top.geometryAuthorityScore) - Number(second.geometryAuthorityScore) < 0.1
  )
    return {
      status: "operator-review-required",
      sourceFileId: null,
      reason: "multiple-high-confidence-geometry-candidates",
    };

  return {
    status: "suggested",
    sourceFileId: top.sourceFileId,
    score: Number(top.geometryAuthorityScore),
    reason: "unique-high-confidence-geometry-candidate",
  };
}

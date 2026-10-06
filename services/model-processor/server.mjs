import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FBX_PROCESSOR_CONTRACT = "rekixo-fbx-canonical-glb";
export const FBX_PROCESSOR_VERSION = 4;
export const FBX_PROCESSOR_EXECUTION = "serialized-node-fbx-v4-reviewed-scale";
export const MAX_FBX_BYTES = 64 * 1024 * 1024;
export const MAX_GLB_BYTES = 256 * 1024 * 1024;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const IDENTITY_PATTERN = /^[A-Za-z0-9_-]{8,120}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class RequestError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function headerValue(headers, name) {
  const value =
    typeof headers?.get === "function"
      ? headers.get(name)
      : headers?.[name.toLowerCase()] ?? headers?.[name];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function requiredIdentity(headers, name, label) {
  const value = headerValue(headers, name);
  if (!IDENTITY_PATTERN.test(value))
    throw new RequestError(400, "INVALID_SOURCE_IDENTITY", `Valid ${label} is required.`);
  return value;
}

function reviewedScaleHeaders(headers) {
  const decisionId = headerValue(headers, "x-rekixo-scale-decision-id");
  const scaleText = headerValue(headers, "x-rekixo-reviewed-metres-per-source-unit");
  if (!decisionId && !scaleText) return null;
  const metresPerSourceUnit = Number(scaleText);
  if (
    !IDENTITY_PATTERN.test(decisionId) ||
    !Number.isFinite(metresPerSourceUnit) ||
    metresPerSourceUnit < 0.000001 ||
    metresPerSourceUnit > 1000000
  ) {
    throw new RequestError(
      400,
      "INVALID_SCALE_DECISION",
      "Reviewed scale requires a valid decision ID and finite metres-per-source-unit value.",
    );
  }
  return { id: decisionId, metresPerSourceUnit };
}

export function validateFbxRequestHeaders(headers) {
  const sourceFileId = requiredIdentity(
    headers,
    "x-rekixo-source-file-id",
    "Source Pack file ID",
  );
  const sourcePackId = requiredIdentity(
    headers,
    "x-rekixo-source-pack-id",
    "Source Pack ID",
  );
  const processingJobId = requiredIdentity(
    headers,
    "x-rekixo-processing-job-id",
    "processing job ID",
  );
  const sourceSha256 = headerValue(headers, "x-rekixo-source-sha256").toLowerCase();
  if (!SHA256_PATTERN.test(sourceSha256))
    throw new RequestError(400, "INVALID_SOURCE_SHA256", "Valid source SHA-256 is required.");

  const encodedName = headerValue(headers, "x-rekixo-source-name");
  let sourceName;
  try {
    sourceName = decodeURIComponent(encodedName);
  } catch {
    throw new RequestError(400, "INVALID_SOURCE_NAME", "Source filename encoding is invalid.");
  }
  if (
    !sourceName ||
    sourceName.length > 260 ||
    /[\u0000-\u001f\u007f]/.test(sourceName) ||
    !/\.fbx$/i.test(sourceName)
  )
    throw new RequestError(400, "INVALID_SOURCE_NAME", "Valid percent-encoded FBX source filename is required.");

  return {
    sourceFileId,
    sourcePackId,
    processingJobId,
    sourceSha256,
    sourceName,
    scaleDecision: reviewedScaleHeaders(headers),
  };
}

export async function readBoundedBody(stream, maxBytes = MAX_FBX_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes)
      throw new RequestError(413, "FBX_SIZE_LIMIT", "FBX exceeds the 64 MiB model-processor limit.");
    chunks.push(bytes);
  }
  if (total === 0)
    throw new RequestError(400, "EMPTY_FBX", "FBX request body is required.");
  return Buffer.concat(chunks, total);
}

function safeEqualHex(left, right) {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function inspectGlbBuffer(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 20)
    throw new RequestError(502, "INVALID_GLB_OUTPUT", "FBX converter returned a truncated GLB.");

  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (magic !== GLB_MAGIC || version !== 2 || declaredLength !== buffer.length)
    throw new RequestError(502, "INVALID_GLB_OUTPUT", "FBX converter returned an invalid GLB 2.0 header.");
  if (jsonType !== GLB_JSON_CHUNK || jsonLength <= 0 || 20 + jsonLength > buffer.length)
    throw new RequestError(502, "INVALID_GLB_OUTPUT", "FBX converter returned an invalid GLB JSON chunk.");

  let metadata;
  try {
    const jsonText = buffer
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .replace(/[\u0000\u0020\t\r\n]+$/g, "");
    metadata = JSON.parse(jsonText);
  } catch {
    throw new RequestError(502, "INVALID_GLB_OUTPUT", "FBX converter returned malformed glTF JSON.");
  }
  if (!metadata?.asset || !String(metadata.asset.version || "").startsWith("2"))
    throw new RequestError(502, "INVALID_GLB_OUTPUT", "FBX converter output is not glTF 2.x.");

  const externalBuffer = Array.isArray(metadata.buffers)
    ? metadata.buffers.some((item) => typeof item?.uri === "string" && item.uri && !item.uri.startsWith("data:"))
    : false;
  const externalImage = Array.isArray(metadata.images)
    ? metadata.images.some((item) => typeof item?.uri === "string" && item.uri && !item.uri.startsWith("data:"))
    : false;
  if (externalBuffer || externalImage)
    throw new RequestError(502, "EXTERNAL_GLTF_DEPENDENCY", "Canonical GLB output must be self-contained.");

  return {
    version,
    byteSize: buffer.length,
    assetVersion: String(metadata.asset.version),
  };
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function parseDeclaredLength(headers) {
  const raw = headerValue(headers, "content-length");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RequestError(400, "INVALID_CONTENT_LENGTH", "Content-Length is invalid.");
  if (value > MAX_FBX_BYTES)
    throw new RequestError(413, "FBX_SIZE_LIMIT", "FBX exceeds the 64 MiB model-processor limit.");
  return value;
}

let conversionTail = Promise.resolve();

function serializeConversion(task) {
  const run = conversionTail.then(task, task);
  conversionTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function requireCanonicalMetreReport(report, identity) {
  const sourceUnitScaleFactorCmPerUnit = Number(report?.sourceUnitScaleFactorCmPerUnit);
  const appliedMetreScale = Number(report?.appliedMetreScale);
  const scaleSanity = report?.scaleSanity;
  const expectedBasis = identity.scaleDecision ? "reviewed-operator" : "declared-fbx-unit";
  const expectedCoordinatePolicy = identity.scaleDecision
    ? "fbx-reviewed-scale-normalized-to-metres"
    : "fbx-unit-scale-factor-normalized-to-metres";
  if (
    report?.outputUnits !== "metre" ||
    report?.coordinatePolicy !== expectedCoordinatePolicy ||
    report?.scaleBasis !== expectedBasis ||
    !Number.isFinite(sourceUnitScaleFactorCmPerUnit) ||
    sourceUnitScaleFactorCmPerUnit <= 0 ||
    !Number.isFinite(appliedMetreScale) ||
    appliedMetreScale <= 0 ||
    (identity.scaleDecision && appliedMetreScale !== identity.scaleDecision.metresPerSourceUnit) ||
    scaleSanity?.status !== "pass" ||
    scaleSanity?.scaleBasis !== expectedBasis ||
    typeof scaleSanity?.policy !== "string" ||
    !Array.isArray(scaleSanity?.rawDimensions) ||
    scaleSanity.rawDimensions.length !== 3 ||
    !Array.isArray(scaleSanity?.canonicalDimensionsM) ||
    scaleSanity.canonicalDimensionsM.length !== 3
  ) {
    throw new RequestError(
      502,
      "CONVERTER_UNIT_POLICY_MISMATCH",
      "FBX converter did not prove canonical metre normalization, reviewed scale provenance, and metric sanity.",
    );
  }
  return {
    sourceUnitScaleFactorCmPerUnit,
    appliedMetreScale,
    scaleBasis: expectedBasis,
    coordinatePolicy: expectedCoordinatePolicy,
    scaleSanity,
  };
}

function dimensionsHeader(values) {
  return values.map((value) => Number(value).toPrecision(12)).join(",");
}

async function convertVerifiedFbx(identity, bytes) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rekixo-fbx-"));
  const input = path.join(tempRoot, "source.fbx");
  const output = path.join(tempRoot, "canonical.glb");
  try {
    await fs.writeFile(input, bytes);
    let report;
    try {
      report = await serializeConversion(async () => {
        const { convertSourceFbx } = await import(
          "../../scripts/asset-pipeline/convert-source-fbx.mjs"
        );
        return convertSourceFbx(input, output, {
          normalizeUnitsToMeters: true,
          metresPerSourceUnitOverride: identity.scaleDecision?.metresPerSourceUnit ?? null,
        });
      });
    } catch (error) {
      if (error?.code === "FBX_UNIT_METADATA_INVALID") {
        throw new RequestError(
          422,
          "FBX_UNIT_METADATA_INVALID",
          "FBX source must declare a valid GlobalSettings.UnitScaleFactor before canonical conversion.",
        );
      }
      if (error?.code === "FBX_REVIEWED_SCALE_INVALID") {
        throw new RequestError(
          422,
          "FBX_REVIEWED_SCALE_INVALID",
          "Reviewed FBX scale is outside the accepted metres-per-source-unit boundary.",
        );
      }
      if (error?.code === "FBX_SCALE_REVIEW_REQUIRED") {
        throw new RequestError(
          422,
          "FBX_SCALE_REVIEW_REQUIRED",
          error instanceof Error ? error.message : "FBX scale review is required.",
          error?.details,
        );
      }
      if (error instanceof RequestError) throw error;
      console.error("FBX conversion failed:", error instanceof Error ? error.message : error);
      throw new RequestError(422, "FBX_CONVERSION_FAILED", "FBX source could not be converted to canonical GLB.");
    }

    if (!safeEqualHex(String(report?.sourceSha256 || ""), identity.sourceSha256))
      throw new RequestError(502, "CONVERTER_SOURCE_IDENTITY_MISMATCH", "FBX converter source identity did not match the verified request.");

    const unitReport = requireCanonicalMetreReport(report, identity);
    const stat = await fs.stat(output);
    if (!Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > MAX_GLB_BYTES)
      throw new RequestError(502, "GLB_OUTPUT_LIMIT", "Canonical GLB output exceeded the 256 MiB safety boundary.");
    const glb = await fs.readFile(output);
    inspectGlbBuffer(glb);
    const outputSha256 = createHash("sha256").update(glb).digest("hex");
    return { glb, outputSha256, report, unitReport };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleConversion(request, response) {
  const identity = validateFbxRequestHeaders(request.headers);
  const declaredLength = parseDeclaredLength(request.headers);
  const bytes = await readBoundedBody(request);
  if (declaredLength !== null && declaredLength !== bytes.length)
    throw new RequestError(400, "CONTENT_LENGTH_MISMATCH", "Content-Length did not match the received FBX bytes.");

  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (!safeEqualHex(actualSha256, identity.sourceSha256))
    throw new RequestError(409, "SOURCE_SHA256_MISMATCH", "Received FBX bytes do not match the declared source SHA-256.");

  const { glb, outputSha256, report, unitReport } = await convertVerifiedFbx(identity, bytes);
  response.writeHead(200, {
    "content-type": "model/gltf-binary",
    "content-length": String(glb.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-rekixo-contract": FBX_PROCESSOR_CONTRACT,
    "x-rekixo-contract-version": String(FBX_PROCESSOR_VERSION),
    "x-rekixo-source-file-id": identity.sourceFileId,
    "x-rekixo-source-pack-id": identity.sourcePackId,
    "x-rekixo-processing-job-id": identity.processingJobId,
    "x-rekixo-source-sha256": identity.sourceSha256,
    "x-rekixo-output-sha256": outputSha256,
    "x-rekixo-coordinate-policy": unitReport.coordinatePolicy,
    "x-rekixo-output-units": "metre",
    "x-rekixo-source-unit-scale-factor": String(unitReport.sourceUnitScaleFactorCmPerUnit),
    "x-rekixo-applied-metre-scale": String(unitReport.appliedMetreScale),
    "x-rekixo-scale-basis": unitReport.scaleBasis,
    ...(identity.scaleDecision
      ? { "x-rekixo-scale-decision-id": identity.scaleDecision.id }
      : {}),
    "x-rekixo-scale-sanity": unitReport.scaleSanity.status,
    "x-rekixo-scale-sanity-policy": unitReport.scaleSanity.policy,
    "x-rekixo-raw-bounds-dimensions": dimensionsHeader(unitReport.scaleSanity.rawDimensions),
    "x-rekixo-canonical-bounds-dimensions-m": dimensionsHeader(unitReport.scaleSanity.canonicalDimensionsM),
    "x-rekixo-mesh-count": String(Number(report?.meshCount || 0)),
    "x-rekixo-triangle-count": String(Number(report?.triangleCount || 0)),
    "x-rekixo-material-count": String(Number(report?.materialCount || 0)),
  });
  response.end(glb);
}

export function createModelProcessorServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://model-processor");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          processor: "rekixo-model-processor",
          contract: FBX_PROCESSOR_CONTRACT,
          version: FBX_PROCESSOR_VERSION,
          maxFbxBytes: MAX_FBX_BYTES,
          maxGlbBytes: MAX_GLB_BYTES,
          outputUnits: "metre",
          execution: FBX_PROCESSOR_EXECUTION,
          metricSanity: "required",
          reviewedScaleDecisions: "supported",
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/model/fbx-to-glb") {
        await handleConversion(request, response);
        return;
      }
      sendJson(response, 404, { error: "Not found.", code: "NOT_FOUND" });
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.status, {
          error: error.message,
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
        });
        return;
      }
      console.error("Model processor request failed:", error);
      sendJson(response, 500, {
        error: "Model processor failed safely.",
        code: "MODEL_PROCESSOR_FAILED",
      });
    }
  });
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const port = Number(process.env.PORT || 8080);
  const server = createModelProcessorServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Rekixo model processor listening on :${port}`);
  });
}

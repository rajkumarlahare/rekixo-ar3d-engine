export const FBX_MODEL_PROCESSOR_CONTRACT = "rekixo-fbx-canonical-glb";
export const FBX_MODEL_PROCESSOR_VERSION = 3;
export const FBX_MODEL_PROCESSOR_EXECUTION = "serialized-node-fbx-v3-metric-sanity";
export const MAX_FBX_PROCESSOR_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_FBX_PROCESSOR_OUTPUT_BYTES = 256 * 1024 * 1024;

const IDENTITY_PATTERN = /^[A-Za-z0-9_-]{8,120}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HEALTH_JSON_LIMIT = 16 * 1024;
const ERROR_JSON_LIMIT = 16 * 1024;

function adapterError(code, message, status = 503, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function validIdentity(value) {
  return typeof value === "string" && IDENTITY_PATTERN.test(value);
}

function validSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value.toLowerCase());
}

function positiveFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteTriplet(value) {
  const values = String(value || "")
    .split(",")
    .map((item) => Number(item));
  return values.length === 3 && values.every((item) => Number.isFinite(item) && item >= 0)
    ? values
    : null;
}

function bindingClient(env, sourceSha256 = "0".repeat(64)) {
  const binding = env?.MODEL_PROCESSOR;
  if (!binding) return null;
  if (typeof binding.fetch === "function") return binding;
  if (typeof binding.getByName === "function") {
    const index = Number.parseInt(String(sourceSha256).slice(0, 8), 16) % 2;
    const client = binding.getByName(`fbx-${index}`);
    return client && typeof client.fetch === "function" ? client : null;
  }
  return null;
}

async function readBoundedText(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw adapterError("MODEL_PROCESSOR_RESPONSE_LIMIT", "Model processor response exceeded its metadata safety limit.", 502);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes)
        throw adapterError("MODEL_PROCESSOR_RESPONSE_LIMIT", "Model processor response exceeded its metadata safety limit.", 502);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function validateHealth(payload) {
  return Boolean(
    payload &&
      payload.processor === "rekixo-model-processor" &&
      payload.contract === FBX_MODEL_PROCESSOR_CONTRACT &&
      Number(payload.version) === FBX_MODEL_PROCESSOR_VERSION &&
      payload.outputUnits === "metre" &&
      payload.execution === FBX_MODEL_PROCESSOR_EXECUTION &&
      payload.metricSanity === "required" &&
      Number(payload.maxFbxBytes) === MAX_FBX_PROCESSOR_INPUT_BYTES &&
      Number(payload.maxGlbBytes) === MAX_FBX_PROCESSOR_OUTPUT_BYTES,
  );
}

export function hasFbxModelProcessorBinding(env) {
  return Boolean(bindingClient(env));
}

export async function fbxModelProcessorCapability(env) {
  const client = bindingClient(env);
  if (!client)
    return {
      available: false,
      reason: "not-configured",
      contract: FBX_MODEL_PROCESSOR_CONTRACT,
      version: FBX_MODEL_PROCESSOR_VERSION,
    };

  let response;
  try {
    response = await client.fetch("https://model-processor/health", {
      method: "GET",
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    return {
      available: false,
      reason: "unreachable",
      diagnostic: error instanceof Error ? error.message.slice(0, 500) : "Unknown processor error.",
      contract: FBX_MODEL_PROCESSOR_CONTRACT,
      version: FBX_MODEL_PROCESSOR_VERSION,
    };
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return {
      available: false,
      reason: `health-http-${response.status}`,
      contract: FBX_MODEL_PROCESSOR_CONTRACT,
      version: FBX_MODEL_PROCESSOR_VERSION,
    };
  }

  let payload;
  try {
    payload = JSON.parse(await readBoundedText(response, HEALTH_JSON_LIMIT));
  } catch (error) {
    return {
      available: false,
      reason: "invalid-health-contract",
      diagnostic: error instanceof Error ? error.message.slice(0, 500) : undefined,
      contract: FBX_MODEL_PROCESSOR_CONTRACT,
      version: FBX_MODEL_PROCESSOR_VERSION,
    };
  }

  if (!validateHealth(payload))
    return {
      available: false,
      reason: "health-contract-mismatch",
      contract: FBX_MODEL_PROCESSOR_CONTRACT,
      version: FBX_MODEL_PROCESSOR_VERSION,
    };

  return {
    available: true,
    reason: null,
    contract: payload.contract,
    version: Number(payload.version),
    execution: payload.execution,
    outputUnits: payload.outputUnits,
    maxFbxBytes: Number(payload.maxFbxBytes),
    maxGlbBytes: Number(payload.maxGlbBytes),
  };
}

function validateRequest(identity, sourceBody) {
  if (!identity || typeof identity !== "object")
    throw adapterError("INVALID_FBX_PROCESSOR_IDENTITY", "FBX processor identity is required.", 400);
  for (const [key, label] of [
    ["sourceFileId", "source file ID"],
    ["sourcePackId", "source pack ID"],
    ["processingJobId", "processing job ID"],
  ]) {
    if (!validIdentity(identity[key]))
      throw adapterError("INVALID_FBX_PROCESSOR_IDENTITY", `Valid ${label} is required.`, 400);
  }
  const sourceSha256 = String(identity.sourceSha256 || "").toLowerCase();
  if (!validSha256(sourceSha256))
    throw adapterError("INVALID_FBX_PROCESSOR_SHA256", "Valid FBX source SHA-256 is required.", 400);
  const sourceName = String(identity.sourceName || "");
  if (
    !sourceName ||
    sourceName.length > 260 ||
    /[\u0000-\u001f\u007f]/.test(sourceName) ||
    !/\.fbx$/i.test(sourceName)
  )
    throw adapterError("INVALID_FBX_PROCESSOR_NAME", "Valid FBX source filename is required.", 400);
  const byteSize = Number(identity.byteSize);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_FBX_PROCESSOR_INPUT_BYTES)
    throw adapterError("FBX_PROCESSOR_INPUT_LIMIT", "FBX source exceeds the 64 MiB model-processor boundary.", 413);
  if (!sourceBody)
    throw adapterError("FBX_PROCESSOR_BODY_REQUIRED", "FBX source body is required.", 400);
  return { ...identity, sourceSha256, sourceName, byteSize };
}

async function processorFailure(response) {
  let payload = null;
  try {
    const text = await readBoundedText(response, ERROR_JSON_LIMIT);
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep a stable upstream-safe error when error metadata is malformed.
  }
  const code =
    typeof payload?.code === "string" && payload.code.length <= 120
      ? payload.code
      : "FBX_PROCESSOR_REJECTED";
  const message =
    typeof payload?.error === "string" && payload.error.length > 0
      ? payload.error.slice(0, 1000)
      : `FBX model processor returned HTTP ${response.status}.`;
  const details =
    payload?.details && typeof payload.details === "object" && !Array.isArray(payload.details)
      ? payload.details
      : undefined;
  throw adapterError(
    code,
    message,
    response.status >= 400 && response.status < 600 ? response.status : 502,
    details,
  );
}

function responseHeader(response, name) {
  return String(response.headers.get(name) || "").trim();
}

function validateConversionResponse(response, identity) {
  const contentType = responseHeader(response, "content-type").toLowerCase();
  const contentLength = Number(responseHeader(response, "content-length"));
  const outputSha256 = responseHeader(response, "x-rekixo-output-sha256").toLowerCase();
  const sourceScale = positiveFinite(responseHeader(response, "x-rekixo-source-unit-scale-factor"));
  const metreScale = positiveFinite(responseHeader(response, "x-rekixo-applied-metre-scale"));
  const rawDimensions = finiteTriplet(responseHeader(response, "x-rekixo-raw-bounds-dimensions"));
  const canonicalDimensionsM = finiteTriplet(
    responseHeader(response, "x-rekixo-canonical-bounds-dimensions-m"),
  );
  const scaleSanityPolicy = responseHeader(response, "x-rekixo-scale-sanity-policy");

  if (!contentType.startsWith("model/gltf-binary"))
    throw adapterError("FBX_PROCESSOR_CONTENT_TYPE_MISMATCH", "FBX model processor did not return canonical GLB content.", 502);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_FBX_PROCESSOR_OUTPUT_BYTES
  )
    throw adapterError("FBX_PROCESSOR_OUTPUT_LIMIT", "FBX model processor returned an invalid canonical GLB byte size.", 502);
  if (
    responseHeader(response, "x-rekixo-contract") !== FBX_MODEL_PROCESSOR_CONTRACT ||
    Number(responseHeader(response, "x-rekixo-contract-version")) !== FBX_MODEL_PROCESSOR_VERSION ||
    responseHeader(response, "x-rekixo-source-file-id") !== identity.sourceFileId ||
    responseHeader(response, "x-rekixo-source-pack-id") !== identity.sourcePackId ||
    responseHeader(response, "x-rekixo-processing-job-id") !== identity.processingJobId ||
    responseHeader(response, "x-rekixo-source-sha256").toLowerCase() !== identity.sourceSha256 ||
    responseHeader(response, "x-rekixo-output-units") !== "metre" ||
    responseHeader(response, "x-rekixo-coordinate-policy") !== "fbx-unit-scale-factor-normalized-to-metres" ||
    responseHeader(response, "x-rekixo-scale-sanity") !== "pass" ||
    !scaleSanityPolicy ||
    !validSha256(outputSha256) ||
    sourceScale === null ||
    metreScale === null ||
    rawDimensions === null ||
    canonicalDimensionsM === null
  )
    throw adapterError("FBX_PROCESSOR_PROVENANCE_MISMATCH", "FBX model processor response failed canonical provenance and metric-sanity validation.", 502);

  return {
    byteSize: contentLength,
    sha256: outputSha256,
    sourceUnitScaleFactorCmPerUnit: sourceScale,
    appliedMetreScale: metreScale,
    scaleSanity: "pass",
    scaleSanityPolicy,
    rawDimensions,
    canonicalDimensionsM,
    execution: FBX_MODEL_PROCESSOR_EXECUTION,
    coordinatePolicy: "fbx-unit-scale-factor-normalized-to-metres",
    outputUnits: "metre",
  };
}

export async function convertFbxWithModelProcessor(env, identity, sourceBody) {
  const verified = validateRequest(identity, sourceBody);
  const client = bindingClient(env, verified.sourceSha256);
  if (!client)
    throw adapterError(
      "FBX_PROCESSOR_UNAVAILABLE",
      "FBX canonical processing is not configured on this deployment.",
      503,
    );

  const headers = new Headers({
    "content-type": "application/octet-stream",
    "content-length": String(verified.byteSize),
    "x-rekixo-source-file-id": verified.sourceFileId,
    "x-rekixo-source-pack-id": verified.sourcePackId,
    "x-rekixo-processing-job-id": verified.processingJobId,
    "x-rekixo-source-sha256": verified.sourceSha256,
    "x-rekixo-source-name": encodeURIComponent(verified.sourceName),
  });

  let response;
  try {
    response = await client.fetch("https://model-processor/v1/model/fbx-to-glb", {
      method: "POST",
      headers,
      body: sourceBody,
    });
  } catch (error) {
    throw adapterError(
      "FBX_PROCESSOR_UNAVAILABLE",
      error instanceof Error
        ? `FBX model processor is temporarily unavailable: ${error.message.slice(0, 500)}`
        : "FBX model processor is temporarily unavailable.",
      503,
    );
  }

  if (!response.ok) return processorFailure(response);
  const metadata = validateConversionResponse(response, verified);
  if (!response.body)
    throw adapterError("FBX_PROCESSOR_EMPTY_OUTPUT", "FBX model processor returned no canonical GLB body.", 502);

  return {
    ...metadata,
    body: response.body,
    contentType: "model/gltf-binary",
    contract: FBX_MODEL_PROCESSOR_CONTRACT,
    contractVersion: FBX_MODEL_PROCESSOR_VERSION,
    sourceFileId: verified.sourceFileId,
    sourcePackId: verified.sourcePackId,
    processingJobId: verified.processingJobId,
    sourceSha256: verified.sourceSha256,
  };
}

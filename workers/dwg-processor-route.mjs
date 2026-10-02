const MAX_DWG_BYTES = 32 * 1024 * 1024;
const MAX_RESULT_CHARS = 12 * 1024 * 1024;

export async function processDwgArchitecture(
  request,
  env,
  actor,
  {
    json,
    sameOrigin,
    validAssetId,
    validSha256,
    validProjectId,
    safeText,
  },
) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (!env.DWG_PROCESSOR)
    return json({ error: "DWG processor is not configured." }, { status: 503 });

  const assetId = String(
    request.headers.get("x-rekixo-source-asset-id") || "",
  ).trim();
  const sha256 = String(
    request.headers.get("x-rekixo-source-sha256") || "",
  ).trim().toLowerCase();
  const projectId = String(
    request.headers.get("x-rekixo-project-id") || "",
  ).trim();
  const encodedName = String(
    request.headers.get("x-rekixo-source-name") || "",
  ).trim();

  let sourceName = "";
  try {
    sourceName = decodeURIComponent(encodedName);
  } catch {
    return json(
      { error: "DWG source filename encoding is invalid." },
      { status: 400 },
    );
  }

  if (!validAssetId(assetId) || !validSha256(sha256))
    return json(
      { error: "Valid DWG source asset identity and SHA-256 are required." },
      { status: 400 },
    );
  if (projectId && !validProjectId(projectId))
    return json({ error: "Valid project ID is required." }, { status: 400 });
  if (!safeText(sourceName, 260) || !/\.dwg$/i.test(sourceName))
    return json(
      { error: "Valid DWG source filename is required." },
      { status: 400 },
    );

  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_DWG_BYTES)
    return json(
      { error: "DWG exceeds the 32 MB processor limit." },
      { status: 413 },
    );

  const index = Number.parseInt(sha256.slice(0, 8), 16) % 2;
  const stub = env.DWG_PROCESSOR.getByName(`dwg-${index}`);
  const headers = new Headers();
  headers.set(
    "content-type",
    request.headers.get("content-type") || "application/octet-stream",
  );
  headers.set("x-rekixo-source-asset-id", assetId);
  headers.set("x-rekixo-source-sha256", sha256);
  headers.set("x-rekixo-source-name", sourceName);

  let processorResponse;
  try {
    processorResponse = await stub.fetch(
      new Request("https://dwg-processor/v1/dwg/normalize", {
        method: "POST",
        headers,
        body: request.body,
      }),
    );
  } catch (error) {
    return json(
      {
        error: "DWG processor is temporarily unavailable.",
        diagnostic:
          error instanceof Error ? error.message : "Unknown processor error.",
      },
      { status: 503 },
    );
  }

  const responseText = await processorResponse.text();
  if (responseText.length > MAX_RESULT_CHARS)
    return json(
      { error: "DWG processor result exceeded the 12 MB safety limit." },
      { status: 502 },
    );

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    return json(
      { error: "DWG processor returned malformed JSON." },
      { status: 502 },
    );
  }

  if (!processorResponse.ok) {
    const message =
      payload && typeof payload.error === "string"
        ? payload.error.slice(0, 1400)
        : `DWG processor returned HTTP ${processorResponse.status}.`;
    return json({ error: message }, { status: processorResponse.status });
  }

  if (
    payload?.contract !== "rekixo-dwg-normalized" ||
    payload?.version !== 1 ||
    payload?.source?.assetId !== assetId ||
    String(payload?.source?.sha256 || "").toLowerCase() !== sha256
  )
    return json(
      { error: "DWG processor result failed source identity validation." },
      { status: 502 },
    );

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      actor.email,
      "dwg.processed",
      null,
      assetId,
      JSON.stringify({
        ...(projectId ? { projectId } : {}),
        sourceName,
        sha256,
        processor: payload.processor,
        units: payload.units,
        segments: Array.isArray(payload.segments) ? payload.segments.length : 0,
        dimensions: Array.isArray(payload.dimensions)
          ? payload.dimensions.length
          : 0,
        inserts: Array.isArray(payload.inserts) ? payload.inserts.length : 0,
        objects: Array.isArray(payload.objects) ? payload.objects.length : 0,
      }),
      now,
    )
    .run()
    .catch(() => {});

  return json(payload);
}

const MAX_CAD_PROCESSOR_BYTES = 32 * 1024 * 1024;

const SECURITY_HEADERS = {
  "Content-Security-Policy-Report-Only":
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com; worker-src 'self' blob:",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, item] of Object.entries(SECURITY_HEADERS))
    headers.set(key, item);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function safeText(value, max) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
  );
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function configuredEndpoint(env) {
  const processorUrl = String(env.CAD_PROCESSOR_URL || "").trim();
  const processorToken = String(env.CAD_PROCESSOR_TOKEN || "").trim();
  if (!processorUrl || processorToken.length < 24) return undefined;

  try {
    const endpoint = new URL(processorUrl);
    if (endpoint.protocol !== "https:") return undefined;
    endpoint.pathname = "/v1/process-dwg";
    endpoint.search = "";
    return { endpoint, processorToken };
  } catch {
    return undefined;
  }
}

export async function processCadDwg(request, env, actor, url) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });

  const configured = configuredEndpoint(env);
  if (!configured)
    return json(
      { error: "Controlled DWG processor is not configured." },
      { status: 503 },
    );

  const sourceName = String(url.searchParams.get("name") || "").trim();
  if (!safeText(sourceName, 500) || !/\.dwg$/i.test(sourceName))
    return json({ error: "A valid DWG filename is required." }, { status: 400 });

  const declaredSha = String(
    request.headers.get("x-rekixo-sha256") || "",
  )
    .trim()
    .toLowerCase();
  if (!validSha256(declaredSha))
    return json({ error: "Valid source SHA-256 is required." }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_CAD_PROCESSOR_BYTES)
    return json(
      { error: "DWG exceeds the 32 MB controlled processor limit." },
      { status: 413 },
    );

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CAD_PROCESSOR_BYTES)
    return json(
      {
        error:
          bytes.byteLength === 0
            ? "DWG source is empty."
            : "DWG exceeds the 32 MB controlled processor limit.",
      },
      { status: bytes.byteLength === 0 ? 400 : 413 },
    );

  const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(hashBytes, (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
  if (sha256 !== declaredSha)
    return json(
      { error: "DWG checksum changed before controlled processing." },
      { status: 409 },
    );

  configured.endpoint.searchParams.set("name", sourceName);

  let upstream;
  try {
    upstream = await fetch(configured.endpoint.toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${configured.processorToken}`,
        "content-type": "application/acad",
        "x-rekixo-source-sha256": sha256,
      },
      body: bytes,
    });
  } catch {
    return json(
      { error: "Controlled DWG processor is temporarily unavailable." },
      { status: 503 },
    );
  }

  const body = await upstream.text();
  if (body.length > 8 * 1024 * 1024)
    return json(
      { error: "Controlled DWG processor returned an oversized payload." },
      { status: 502 },
    );

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json(
      { error: "Controlled DWG processor returned malformed JSON." },
      { status: 502 },
    );
  }

  if (!upstream.ok)
    return json(
      {
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Controlled DWG processing failed.",
      },
      {
        status:
          upstream.status >= 400 && upstream.status < 600
            ? upstream.status
            : 502,
      },
    );

  await env.DB.prepare(
    `INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      actor.email,
      "cad.dwg_processed",
      null,
      declaredSha,
      JSON.stringify({
        name: sourceName,
        byteSize: bytes.byteLength,
        processor: payload?.processor?.engine || "unknown",
      }),
      new Date().toISOString(),
    )
    .run();

  return json(payload);
}

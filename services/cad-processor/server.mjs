import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { normalizeDxfArchitecture } from "./cad-normalizer.mjs";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 32 * 1024 * 1024;
const PORT = Number(process.env.PORT || 8080);
const PROCESSOR_TOKEN = String(process.env.PROCESSOR_TOKEN || "");
const DWG2DXF_BIN = String(process.env.DWG2DXF_BIN || "dwg2dxf");
const DWG2DXF_VERSION = String(process.env.DWG2DXF_VERSION || "0.14");

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function authorized(request) {
  if (!PROCESSOR_TOKEN) return true;
  return request.headers.authorization === "Bearer " + PROCESSOR_TOKEN;
}

async function readBoundedBody(request) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > MAX_BYTES) throw Object.assign(Error("DWG exceeds 32 MB processor limit."), { status: 413 });
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BYTES)
      throw Object.assign(Error("DWG exceeds 32 MB processor limit."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function dwgVersion(bytes) {
  const head = bytes.subarray(0, Math.min(bytes.length, 16)).toString("ascii").replace(/[^A-Z0-9]/g, "");
  return head.match(/AC10\d{2}/)?.[0];
}

async function processDwg(bytes, sourceName) {
  const version = dwgVersion(bytes);
  if (!version)
    throw Object.assign(Error("Input does not contain a recognized DWG version header."), { status: 400 });

  const dir = await mkdtemp(path.join(tmpdir(), "rekixo-cad-"));
  const input = path.join(dir, "source.dwg");
  const output = path.join(dir, "source.dxf");
  try {
    await writeFile(input, bytes);
    await execFileAsync(
      DWG2DXF_BIN,
      ["-v0", "-y", "-o", output, input],
      { timeout: 45000, maxBuffer: 2 * 1024 * 1024 },
    );
    const dxf = await readFile(output, "utf8");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    return normalizeDxfArchitecture(dxf, {
      sourceName,
      sha256,
      dwgVersion: version,
      engine: "gnu-libredwg-dwg2dxf",
      engineVersion: DWG2DXF_VERSION,
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "rekixo-cad-processor",
        contract: "rekixo-cad-architecture@1",
      });
      return;
    }

    if (url.pathname !== "/v1/process-dwg") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (!authorized(request)) {
      sendJson(response, 401, { error: "Unauthorized." });
      return;
    }

    const bytes = await readBoundedBody(request);
    const sourceName = String(url.searchParams.get("name") || "source.dwg").slice(0, 500);
    const result = await processDwg(bytes, sourceName);
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "DWG processing failed.";
    const status = Number(error?.status) || (/timed out/i.test(message) ? 504 : 422);
    sendJson(response, status, { error: message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Rekixo CAD processor listening on port " + PORT);
});

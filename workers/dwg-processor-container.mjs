import { DurableObject } from "cloudflare:workers";

const PROCESSOR_PORT = 8080;
const INSTANCE_COUNT = 2;
const START_ATTEMPTS = 100;
const START_RETRY_MS = 200;

function processorInstanceName(sha256) {
  const prefix = String(sha256 || "").slice(0, 8);
  const value = Number.parseInt(prefix, 16);
  const index = Number.isFinite(value) ? value % INSTANCE_COUNT : 0;
  return `dwg-${index}`;
}

export class DwgProcessor extends DurableObject {
  ready;

  async fetch(request) {
    const container = this.ctx.container;
    if (!container)
      return new Response(
        JSON.stringify({ error: "DWG processor container is not configured." }),
        {
          status: 503,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );

    if (!container.running) this.ready = undefined;
    this.ready ??= this.startAndWaitForPort().catch((error) => {
      this.ready = undefined;
      throw error;
    });

    try {
      await this.ready;
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "DWG processor container could not become ready.",
          diagnostic:
            error instanceof Error ? error.message : "Unknown container error.",
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return container.getTcpPort(PROCESSOR_PORT).fetch(forwarded);
  }

  async startAndWaitForPort() {
    const container = this.ctx.container;
    await container.setInactivityTimeout(5 * 60 * 1000);
    if (!container.running) container.start();

    this.ctx.waitUntil(
      container
        .monitor()
        .then(() => console.log("DWG processor container stopped."))
        .catch((error) =>
          console.error("DWG processor container error:", error),
        ),
    );

    const port = container.getTcpPort(PROCESSOR_PORT);
    let lastError;
    for (let attempt = 0; attempt < START_ATTEMPTS; attempt += 1) {
      try {
        const response = await port.fetch("http://container/health");
        if (!response.ok)
          throw Error(`DWG processor health returned HTTP ${response.status}.`);
        return;
      } catch (error) {
        lastError = error;
        await scheduler.wait(START_RETRY_MS);
      }
    }

    throw new Error("DWG processor did not become ready on port 8080.", {
      cause: lastError,
    });
  }
}

export function dwgProcessorStub(env, sha256) {
  if (!env?.DWG_PROCESSOR)
    throw Error("DWG processor binding is not configured.");
  return env.DWG_PROCESSOR.getByName(processorInstanceName(sha256));
}

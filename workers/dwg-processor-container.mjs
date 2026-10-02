import { DurableObject } from "cloudflare:workers";

const PROCESSOR_PORT = 8080;
const START_ATTEMPTS = 100;
const START_RETRY_MS = 200;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

export class DwgProcessor extends DurableObject {
  ready;

  constructor(ctx, env) {
    super(ctx, env);
    if (ctx.container?.running) {
      ctx.blockConcurrencyWhile(async () => {
        await ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
        this.monitorContainer();
      });
    }
  }

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

  monitorContainer() {
    const container = this.ctx.container;
    this.ctx.waitUntil(
      container
        .monitor()
        .then(() => {
          this.ready = undefined;
          console.log("DWG processor container stopped.");
        })
        .catch((error) => {
          this.ready = undefined;
          console.error("DWG processor container error:", error);
        }),
    );
  }

  async startAndWaitForPort() {
    const container = this.ctx.container;
    if (!container.running) container.start();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    this.monitorContainer();

    const port = container.getTcpPort(PROCESSOR_PORT);
    let lastError;
    for (let attempt = 0; attempt < START_ATTEMPTS; attempt += 1) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1_000),
        });
        await response.body?.cancel();
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

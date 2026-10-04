import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

interface GoldenManifestSource {
  role: "model" | "cad" | "sketchup" | "drawing" | "visual" | "metadata";
  fileName: string;
  size: number;
  sha256: string;
}

interface GoldenManifest {
  schema: 1;
  key: string;
  sources: GoldenManifestSource[];
}

const packDir = process.env.REKIXO_GOLDEN_PACK_DIR?.trim();
const manifestPath = process.env.REKIXO_GOLDEN_MANIFEST?.trim();
const processorUrl = process.env.REKIXO_DWG_PROCESSOR_URL?.trim();

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function processorEndpoint(value: string) {
  const url = new URL(value);
  if (url.pathname === "/" || !url.pathname)
    url.pathname = "/v1/dwg/normalize";
  return url.toString();
}

function readManifest(fileName: string) {
  const value = JSON.parse(fs.readFileSync(fileName, "utf8")) as GoldenManifest;
  if (value.schema !== 1 || !value.key || value.sources.length !== 6)
    throw Error("Golden source manifest is invalid.");
  return value;
}

function sourcePaths(directory: string, manifest: GoldenManifest) {
  const root = path.resolve(directory);
  return manifest.sources.map((source) => {
    const resolved = path.resolve(root, source.fileName);
    if (!resolved.startsWith(`${root}${path.sep}`))
      throw Error(`Golden source path escapes the private pack: ${source.role}`);
    const info = fs.statSync(resolved);
    if (!info.isFile() || info.size !== source.size)
      throw Error(`Golden source size mismatch before browser upload: ${source.role}`);
    return resolved;
  });
}

async function isolateCloud(page: import("@playwright/test").Page) {
  await page.route("**/3Dprojects/api/cloud/session", (route) =>
    route.fulfill(
      json({
        configured: true,
        databaseReady: true,
        authenticated: false,
      }),
    ),
  );
  await page.route("**/3Dprojects/api/releases", (route) =>
    route.fulfill(json({ releases: [] })),
  );
  await page.route("**/3Dprojects/published/catalog.json", (route) =>
    route.fulfill(json([])),
  );
}

async function bridgeRealDwgProcessor(
  page: import("@playwright/test").Page,
  baseUrl: string,
) {
  await page.route("**/3Dprojects/api/cloud/processors/dwg", async (route) => {
    const request = route.request();
    const requestHeaders = request.headers();
    const body = request.postDataBuffer();
    if (!body) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Golden E2E received an empty DWG body." }),
      });
      return;
    }

    let sourceName = requestHeaders["x-rekixo-source-name"] ?? "source.dwg";
    try {
      sourceName = decodeURIComponent(sourceName);
    } catch {
      // Preserve the original header and let the processor reject it safely.
    }

    const response = await fetch(processorEndpoint(baseUrl), {
      method: "POST",
      headers: {
        "content-type": requestHeaders["content-type"] ?? "application/octet-stream",
        "x-rekixo-source-asset-id":
          requestHeaders["x-rekixo-source-asset-id"] ?? "",
        "x-rekixo-source-sha256":
          requestHeaders["x-rekixo-source-sha256"] ?? "",
        "x-rekixo-source-name": sourceName,
      },
      body,
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    await route.fulfill({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      body: responseBody,
    });
  });
}

test.describe("private golden six-file source pack", () => {
  test.skip(
    !packDir || !manifestPath || !processorUrl,
    "Set REKIXO_GOLDEN_PACK_DIR, REKIXO_GOLDEN_MANIFEST and REKIXO_DWG_PROCESSOR_URL to run the protected real-pack E2E.",
  );

  test("real six-role pack reaches zero-blocker AutoBuild and survives reload", async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);
    const manifest = readManifest(manifestPath!);
    const files = sourcePaths(packDir!, manifest);

    await isolateCloud(page);
    await bridgeRealDwgProcessor(page, processorUrl!);
    await page.goto("/3Dprojects/studio");
    await expect(page.getByLabel("Smart 3D project builder")).toBeVisible();

    const projectTitle = `Golden AutoBuild ${manifest.key}`;
    await page.getByLabel("Project title").fill(projectTitle);

    const sourceInput = page.locator(".smart-builder input[type=file]").first();
    await sourceInput.setInputFiles(files);

    const readiness = page.getByTestId("source-pack-readiness");
    await expect(readiness).toContainText("Complete six-role source pack attached.", {
      timeout: 120_000,
    });
    await expect(readiness).toContainText(
      "Automatic building can start from the attached sources.",
    );

    const autoBuild = page.getByTestId("build-automatically");
    await expect(autoBuild).toBeEnabled();
    await autoBuild.click();

    const feedback = page.locator(".studio-feedback");
    await expect(feedback).toContainText("Automatic build complete", {
      timeout: 8 * 60_000,
    });
    await expect(feedback).toContainText(/certification \d+% \(0 blocked · \d+ review\)/i);
    await expect(page.getByTestId("open-visual-editor")).toBeEnabled();

    await expect(page.getByText("Autosaved", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.reload();
    await expect(page.getByLabel("Project title")).toHaveValue(projectTitle, {
      timeout: 60_000,
    });

    const modelSource = manifest.sources.find((source) => source.role === "model")!;
    await expect(page.getByLabel("Authoring / source 3D model")).toContainText(
      modelSource.fileName,
      { timeout: 60_000 },
    );
    await page.getByTestId("open-visual-editor").click();
    await expect(page.getByLabel("3D editor tools")).toBeVisible({ timeout: 60_000 });
    const visualReview = page.getByTestId("visual-facade-review");
    await expect(visualReview).toBeVisible({ timeout: 60_000 });
    await visualReview.locator("summary").click();
    await expect(page.getByTestId("visual-reference-summary")).toContainText(/[1-9]\d* color region/i, { timeout: 60_000 });
  });
});

import { expect, test } from "@playwright/test";
import path from "node:path";

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

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

function fourFloorGltf() {
  const positions = Buffer.alloc(4 * 3 * 4);
  const values = [
    -2, 0, -2,
     2, 0, -2,
    -2, 0.06, 2,
     2, 0.06, 2,
  ];
  values.forEach((value, index) => positions.writeFloatLE(value, index * 4));
  return JSON.stringify({
    asset: { version: "2.0", generator: "Rekixo browser E2E" },
    buffers: [
      {
        byteLength: positions.length,
        uri: `data:application/octet-stream;base64,${positions.toString("base64")}`,
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: "VEC3",
        min: [-2, 0, -2],
        max: [2, 0.06, 2],
      },
    ],
    meshes: [
      {
        name: "Floor slab",
        primitives: [{ attributes: { POSITION: 0 }, mode: 5 }],
      },
    ],
    nodes: [
      { name: "Ground Floor", mesh: 0, translation: [0, 0, 0] },
      { name: "First Floor", mesh: 0, translation: [0, 3, 0] },
      { name: "Second Floor", mesh: 0, translation: [0, 6, 0] },
      { name: "Third Floor", mesh: 0, translation: [0, 9, 0] },
    ],
    scenes: [{ nodes: [0, 1, 2, 3] }],
    scene: 0,
  });
}

function onePixelPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZgK0AAAAASUVORK5CYII=",
    "base64",
  );
}

test.beforeEach(async ({ page }) => {
  await isolateCloud(page);
  await page.goto("/3Dprojects/studio");
  await expect(page.getByLabel("Smart 3D project builder")).toBeVisible();
});

test("local Studio creates, analyzes and survives a browser reload", async ({
  page,
}) => {
  const title = page.getByLabel("Project title");
  await expect(title).toHaveValue("Untitled project");
  await title.fill("Browser E2E Tower");

  const sourceInput = page
    .locator(".smart-builder input[type=file]")
    .first();
  await sourceInput.setInputFiles({
    name: "four-floor.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(fourFloorGltf()),
  });

  await expect(page.getByLabel("Authoring / source 3D model")).toContainText(
    "four-floor.glb",
  );
  const analyze = page.getByTestId("analyze-project");
  await expect(analyze).toBeEnabled();
  await analyze.click();

  await expect(page.locator(".studio-feedback")).toContainText(
    "Smart analysis complete",
  );
  await expect(page.getByText("Selected for analysis")).toBeVisible();
  await expect(page.getByTestId("detected-floor-levels")).toBeVisible();

  const build = page.getByTestId("build-analyzed-draft");
  await expect(build).toBeEnabled();
  await build.click();

  await page.getByTestId("open-visual-editor").click();

  const editorTools = page.getByLabel("3D editor tools");
  await expect(page.getByRole("button", { name: "Setup" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Building" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Interior" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Walk" })).toBeVisible();

  const viewMenu = editorTools.locator("summary").filter({ hasText: /^View/ });
  await viewMenu.click();
  await expect(editorTools.getByRole("button", { name: "Perspective" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Top" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Section" })).toBeVisible();

  await editorTools.getByRole("button", { name: "Full screen" }).click();
  await expect(page.getByRole("button", { name: "Setup" })).toBeHidden();
  await expect(page.locator(".editor-fullscreen-exit")).toBeVisible();
  await page.locator(".editor-fullscreen-exit").click();
  await expect(page.getByRole("button", { name: "Setup" })).toBeVisible();

  await editorTools.getByRole("button", { name: "Full screen" }).click();
  await expect(page.locator(".editor-fullscreen-exit")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Setup" })).toBeVisible();

  await editorTools.locator("summary").filter({ hasText: /^Edit/ }).click();
  await expect(editorTools.getByRole("button", { name: /Move/ })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: /Snap/ })).toBeVisible();

  await editorTools.locator("summary").filter({ hasText: /^Floor/ }).click();
  await expect(page.getByLabel("Isolate floor")).toBeVisible();

  await expect(page.getByLabel("Visual realism presets")).toBeVisible();
  const cleanDay = page.getByRole("button", { name: /Clean Day/i });
  await cleanDay.click();
  await expect(cleanDay).toHaveAttribute("aria-pressed", "true");
  await page.locator(".look-fine-tune > summary").click();
  await expect(page.getByLabel("Exposure")).toHaveValue("1.08");

  await expect(page.getByText("Autosaved", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Setup" }).click();
  await expect(page.getByLabel("Project title")).toHaveValue(
    "Browser E2E Tower",
  );
  await expect(page.getByLabel("Authoring / source 3D model")).toContainText(
    "four-floor.glb",
  );

  await page.getByRole("button", { name: "3D Edit" }).click();
  await expect(page.getByLabel("Visual realism presets")).toBeVisible();
  await expect(page.getByRole("button", { name: /Clean Day/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("six-role source pack reaches one-click automatic building in the browser", async ({
  page,
}) => {
  const sourceInput = page.locator(".smart-builder input[type=file]").first();
  await sourceInput.setInputFiles([
    {
      name: "building.glb",
      mimeType: "model/gltf-binary",
      buffer: Buffer.from(fourFloorGltf()),
    },
    {
      name: "architectural-plan.dwg",
      mimeType: "image/vnd.dwg",
      buffer: Buffer.from(
        "AC1015\0AEC_WALL\0AEC_DOOR\0FIRST FLOOR PLAN\0BEDROOM\0KITCHEN\0",
      ),
    },
    {
      name: "design-backup.skb",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("portable-sketch-support"),
    },
    {
      name: "brochure.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    },
    {
      name: "exterior-reference.png",
      mimeType: "image/png",
      buffer: onePixelPng(),
    },
    {
      name: "render-scene.drs",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          model: "building.glb",
          texture: "exterior-reference.png",
        }),
      ),
    },
  ]);

  const readiness = page.getByTestId("source-pack-readiness");
  await expect(readiness).toContainText("Complete six-role source pack attached.");
  await expect(readiness).toContainText(
    "Automatic building can start from the attached sources.",
  );
  for (const role of [
    "3D model",
    "CAD",
    "SketchUp",
    "Drawing/PDF",
    "Visual reference",
    "Render metadata",
  ])
    await expect(readiness).toContainText(role);

  const autoBuild = page.getByTestId("build-automatically");
  await expect(autoBuild).toBeEnabled();
  await autoBuild.click();

  await expect(page.locator(".studio-feedback")).toContainText(
    "Automatic build complete",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("open-visual-editor")).toBeEnabled();
});

test("local autosave survives hard reload without pressing Save local", async ({
  page,
}) => {
  await page.getByLabel("Project title").fill("Autosaved E2E Change");

  await page.getByLabel("More project actions").click();
  await expect(page.getByRole("button", { name: "+ New project" })).toBeDisabled();
  await expect(page.getByLabel("Selected local project")).toBeDisabled();

  await expect(page.getByText("Autosaved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ New project" })).toBeEnabled();

  await page.reload();
  await expect(page.getByLabel("Project title")).toHaveValue(
    "Autosaved E2E Change",
  );
  await expect(page.getByText("Autosaved", { exact: true })).toBeVisible();
});

test("clean Studio has no repository-baked project profile", async ({ page }) => {
  const profileCount = await page.evaluate(async (profileUrl) => {
    const { studioSourceProfiles } = await import(profileUrl);
    return studioSourceProfiles.length;
  }, "/3Dprojects/@fs/" + path.resolve("project-profiles/studio-source-profiles.ts").split(path.sep).join("/"));

  expect(profileCount).toBe(0);
  await expect(page.getByLabel("Smart 3D project builder")).toBeVisible();
  await expect(page.getByText(/Jyoti Paradise/i)).toHaveCount(0);
});

test("reference lighting review applies, undoes, redoes and survives reload", async ({ page }) => {
  await page.locator(".smart-builder input[type=file]").first().setInputFiles([
    { name: "review-building.glb", mimeType: "model/gltf-binary", buffer: Buffer.from(fourFloorGltf()) },
    { name: "review-reference.png", mimeType: "image/png", buffer: onePixelPng() },
  ]);
  await expect(page.getByText("Autosaved", { exact: true })).toBeVisible();
  // Seed analyzed evidence to isolate the review controls from image recognition.
  await page.evaluate(async () => {
    const moduleUrl = "/3Dprojects/src/studio/storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl);
    const [project] = await storage.projects();
    const files = await Promise.all(project.assets.map((id: string) => storage.asset(id)));
    const reference = files.find((file: { name: string }) => file.name === "review-reference.png");
    project.scene.referenceImageEvidence = {
      assetId: reference.id, sourceWidth: 2, sourceHeight: 2, sampledWidth: 2, sampledHeight: 2,
      renderedPalette: ["#101722"], averageLuminance: 0.1, warmFraction: 0,
      darkFraction: 0.9, highlightFraction: 0, averageSaturation: 0.1,
      verticalEdgeStrength: 0, horizontalEdgeStrength: 0,
      lightingMood: "night", confidence: 0.84, sampleCount: 4,
    };
    await storage.save(project);
  });
  await page.reload();
  await page.getByRole("button", { name: "3D Edit" }).click();
  await page.getByText("Reference look review", { exact: true }).click();
  await expect(page.getByText(/Reference: review-reference.png/)).toBeVisible();
  await expect(page.getByText(/No eligible material suggestions/)).toBeVisible();
  await page.getByRole("button", { name: "Apply reviewed lighting" }).click();
  await expect(page.getByRole("button", { name: "Lighting already matches" })).toBeDisabled();
  const editorTools = page.getByLabel("3D editor tools");
  await editorTools.locator("summary").filter({ hasText: /^Edit/ }).click();
  await editorTools.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply reviewed lighting" })).toBeEnabled();
  await editorTools.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lighting already matches" })).toBeDisabled();
  await expect(page.getByText("Autosaved", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "3D Edit" }).click();
  await page.getByText("Reference look review", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Lighting already matches" })).toBeDisabled();
});

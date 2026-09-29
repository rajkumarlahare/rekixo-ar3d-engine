import { expect, test } from "@playwright/test";

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
  const analyze = page.getByRole("button", { name: "Analyze project" });
  await expect(analyze).toBeEnabled();
  await analyze.click();

  await expect(page.locator(".studio-feedback")).toContainText(
    "Smart analysis complete",
  );
  await expect(page.getByText("Selected for analysis")).toBeVisible();
  await expect(page.getByText("Detected floor levels")).toBeVisible();

  const build = page.getByRole("button", { name: "Build smart draft" });
  await expect(build).toBeEnabled();
  await build.click();

  await page.getByRole("button", { name: "Open visual editor" }).click();

  const editorTools = page.getByLabel("3D editor tools");
  await expect(editorTools.getByRole("button", { name: "Building" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Interior" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Walk" })).toBeVisible();

  await editorTools.locator("summary").filter({ hasText: /^View/ }).click();
  await expect(editorTools.getByRole("button", { name: "Perspective" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Top" })).toBeVisible();
  await expect(editorTools.getByRole("button", { name: "Section" })).toBeVisible();

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

  await page.getByRole("button", { name: "Exit full screen" }).click();
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

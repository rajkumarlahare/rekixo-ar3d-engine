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

test("Jyoti source floor preparation, room acceptance and repeat survive reload", async ({ page }) => {
  test.slow(); // Reviews a whole unit and crosses two persistence boundaries.
  // Persist a synthetic identity fixture through the real storage layer. No source assets are modified.
  const fixture = await page.evaluate(async (profileUrl) => {
    const { studioSourceProfiles } = await import(profileUrl);
    const profile = studioSourceProfiles[0];
    const base = "/3Dprojects/src/studio/";
    const { newProject } = await import(base + "domain.ts");
    const storage = await import(base + "storage.ts");
    const { applyFloorSkeleton } = await import(base + "floorSkeleton.ts");
    const projects = await storage.projects();
    const project = projects[0] ?? newProject("Jyoti review fixture");
    project.name = "Jyoti review fixture";
    project.scene.rooms = [];
    project.scene.furniture = [];
    project.scene.floors = applyFloorSkeleton(project.scene, profile.id, profile.floorSkeleton).floors;
    const files = profile.sources.filter((source: { key: string }) => ["floorPlan", "cad"].includes(source.key))
      .map((source: { key: string; sha256: string; byteSize: number }) => ({
        id: source.key, projectId: project.id, name: source.key + ".pdf", type: "application/pdf",
        hash: source.sha256, size: source.byteSize, blob: new Blob(["test identity fixture"]),
      }));
    project.assets = files.map((file: { id: string }) => file.id);
    await storage.save(project, files);
    return { total: profile.roomSheetTemplate.length,
      unit101: profile.roomSheetTemplate.filter((row: { unit: string }) => row.unit === "101").length };
  }, "/3Dprojects/@fs/" + path.resolve("project-profiles/studio-source-profiles.ts").split(path.sep).join("/"));
  const expected = fixture.total;
  await page.reload();
  await page.getByRole("button", { name: "3D Edit", exact: true }).click();
  const tools = page.getByLabel("3D editor tools");
  await tools.locator("summary").filter({ hasText: /^Floor/ }).click();
  const floor = page.getByLabel("Isolate floor");
  await floor.selectOption({ label: "Ground" });
  await expect(page.getByRole("button", { name: /Prepare .* rooms/ })).toHaveCount(0);
  await floor.selectOption({ label: "Floor 1" });
  await page.getByRole("button", { name: "Prepare Floor 1 rooms" }).click();
  const panel = page.getByLabel("Floor room review", { exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(`0/${expected} accepted`);
  await expect(panel.getByRole("button", { name: "Unit 101", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Unit 102", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Unit 103", exact: true })).toBeVisible();
  await panel.locator("summary").filter({ hasText: /Repeat floors/ }).click();
  await expect(panel.getByRole("button", { name: /Generate/ })).toBeDisabled();
  await panel.getByRole("button", { name: "Accept room", exact: true }).click();
  await expect(panel).toContainText(`1/${expected} accepted`);
  await expect(page.getByText("Autosaved", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "3D Edit", exact: true }).click();
  await tools.locator("summary").filter({ hasText: /^Floor/ }).click();
  await floor.selectOption({ label: "Floor 1" });
  await expect(page.getByRole("button", { name: "Prepare Floor 1 rooms" })).toHaveCount(0);
  await page.getByRole("button", { name: "Review floor rooms" }).click();
  await expect(panel).toContainText(`1/${expected} accepted`);
  await panel.getByRole("button", { name: "Unit 101", exact: true }).click();
  const count101 = fixture.unit101;
  for (let index = 1; index < count101; index += 1) {
    await panel.getByLabel("Rooms to review").getByRole("button", { name: /Needs review/ }).first().click();
    await panel.getByRole("button", { name: "Accept room", exact: true }).click();
  }
  await panel.locator("summary").filter({ hasText: /Repeat floors/ }).click();
  await expect(panel.getByRole("button", { name: /Generate 4 units/ })).toBeEnabled();
  await panel.getByRole("button", { name: /Generate 4 units/ }).click();
  await expect(panel).toContainText("Floor 2");
  await expect(panel).toContainText(`0/${count101} accepted`);
  await expect(page.getByText("Autosaved", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

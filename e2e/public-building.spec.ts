import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
test.beforeAll(async () => {
  server = await createServer({ configFile: "apps/public/vite.config.ts", root: "apps/public", server: { host: "127.0.0.1", port: 5174, strictPort: true } });
  await server.listen();
});
test.afterAll(async () => { await server?.close(); });

function sourceFixture() {
  // Tiny source-faithful mesh-bound fixture based on the uploaded Jyoti FBX.
  // Floor controls must be derived from these mesh bounds, not from total
  // model height divided into equal slices.
  const repeatedFootprint = {
    minX: 6.2291105344,
    maxX: 21.9061689429,
    minZ: -23.2059182048,
    maxZ: -2.9837426607,
  };
  const boxes = [
    { name: "Site bounds", minX: 0, maxX: 26.0721642923, minY: 0, maxY: 0.2, minZ: -27.5577864884, maxZ: 0 },
    { name: "Ground", minX: 2.081, maxX: 24.5482, minY: 0.3048, maxY: 3.048, minZ: -25.9488, maxZ: -0.0369 },
    ...[
      [3.048, 6.0452],
      [6.0452, 9.0424],
      [9.0424, 12.0396],
      [12.0396, 15.0368],
    ].map(([minY, maxY], index) => ({
      ...repeatedFootprint, minY, maxY, name: `Floor ${index + 1}`,
    })),
    {
      name: "Upper floor",
      minX: 6.2291105344,
      maxX: 21.9061689429,
      minY: 15.2908,
      maxY: 18.034,
      minZ: -23.2059182048,
      maxZ: -9.8693538499,
    },
    {
      ...repeatedFootprint,
      name: "Roof",
      minY: 18.034,
      maxY: 20.8534,
    },
  ];

  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const bytesPerMesh = 6 * 3 * 4;
  const buffer = Buffer.alloc(boxes.length * bytesPerMesh);

  boxes.forEach((box, index) => {
    const points = [
      [box.minX, box.minY, box.minZ],
      [box.maxX, box.minY, box.minZ],
      [box.maxX, box.maxY, box.maxZ],
      [box.minX, box.minY, box.minZ],
      [box.maxX, box.maxY, box.maxZ],
      [box.minX, box.maxY, box.maxZ],
    ];
    let offset = index * bytesPerMesh;
    for (const point of points) {
      for (const value of point) {
        buffer.writeFloatLE(value, offset);
        offset += 4;
      }
    }
    bufferViews.push({
      buffer: 0,
      byteOffset: index * bytesPerMesh,
      byteLength: bytesPerMesh,
    });
    accessors.push({
      bufferView: index,
      componentType: 5126,
      count: 6,
      type: "VEC3",
      min: [box.minX, box.minY, box.minZ],
      max: [box.maxX, box.maxY, box.maxZ],
    });
    meshes.push({
      name: box.name,
      primitives: [{ attributes: { POSITION: index }, material: 0 }],
    });
    nodes.push({ name: box.name, mesh: index });
  });

  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: buffer.length, uri: `data:application/octet-stream;base64,${buffer.toString("base64")}` }],
    bufferViews,
    accessors,
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.7, 0.6, 1] } }],
    meshes,
    nodes,
    scenes: [{ nodes: nodes.map((_node, index) => index) }],
    scene: 0,
  };
}

test("public exterior client flow works on desktop and mobile without pending/admin controls", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /THREE|shader|WebGL/i.test(message.text())) errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/3Dprojects/api/projects/test-building", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    project: { id: "project_test", slug: "test-building", name: "Example Residence", location: "Configured locality", status: "published" },
    scenes: [{ id: "scene_test", projectId: "project_test", name: "Building", type: "project-navigation", sortOrder: 0, enabled: true, settings: {} }],
    model: { id: "model_test", projectId: "project_test", name: "building.glb", version: 1, available: true, url: "/3Dprojects/api/models/model_test", mimeType: "model/gltf-binary" },
  }) }));
  await page.route("**/3Dprojects/api/releases/projects/test-building/studio", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("**/3Dprojects/api/models/model_test", (route) => route.fulfill({ contentType: "model/gltf+json", body: JSON.stringify(sourceFixture()) }));
  await page.goto("http://127.0.0.1:5174/3Dprojects/test-building");
  try {
    // Software WebGL on shared CI runners can spend several seconds compiling the exterior shaders.
    await expect(page.locator(".viewer-loader")).toBeHidden({ timeout: 60_000 });
  } catch (error) {
    throw new Error(`Public viewer did not finish loading. Browser errors: ${JSON.stringify(errors)}. ${String(error)}`);
  }
  await expect(page.locator(".viewer-canvas")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Select building floor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Ground Floor only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Floor 1 only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Floor 5 only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show roof only" })).toBeVisible();
  await page.getByRole("button", { name: "Show Floor 1 only" }).click();
  await expect(page.getByRole("button", { name: "Show Floor 1 only" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show roof only" }).click();
  await expect(page.getByRole("button", { name: "Show roof only" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await expect(page.getByRole("button", { name: "Top", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".viewer-notice")).toHaveCount(0);
  await expect(page.getByText(/Source pending|Media unavailable|MODEL STATUS|Production/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Walk|Explode|Section)$/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Configured locality in Google Maps" })).toHaveAttribute("href", /query=Configured%20locality/);
  const day = await page.locator(".viewer-canvas").screenshot();
  await page.getByRole("button", { name: "Night", exact: true }).click();
  await expect(page.getByRole("button", { name: "Day", exact: true })).toBeVisible();
  const night = await page.locator(".viewer-canvas").screenshot();
  expect(day.equals(night)).toBe(false);
  await page.getByRole("button", { name: "Corner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Corner", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Front", exact: true }).click();
  await expect(page.getByRole("button", { name: "Front", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
test.beforeAll(async () => {
  server = await createServer({ configFile: "apps/public/vite.config.ts", root: "apps/public", server: { host: "127.0.0.1", port: 5174, strictPort: true } });
  await server.listen();
});
test.afterAll(async () => { await server?.close(); });

function sourceFixture() {
  const bytes = Buffer.alloc(9 * 4);
  [-2, 0, 0, 2, 0, 0, 0, 12, 0].forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  return { asset: { version: "2.0" }, buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString("base64")}` }], bufferViews: [{ buffer: 0, byteLength: bytes.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-2, 0, 0], max: [2, 12, 0] }], materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.7, 0.6, 1] } }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
}

test("public exterior client flow works on desktop and mobile without pending/admin controls", async ({ page }) => {
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
  await expect(page.locator(".viewer-loader")).toBeHidden();
  await expect(page.locator(".viewer-canvas")).toBeVisible();
  await expect(page.locator(".viewer-notice")).toHaveCount(0);
  await expect(page.getByText(/Source pending|Media unavailable|MODEL STATUS|Production/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Walk|Explode|Section)$/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View locality in Maps" })).toHaveAttribute("href", /query=Configured%20locality/);
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

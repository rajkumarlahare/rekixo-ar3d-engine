import { expect, test } from "@playwright/test";

const origin = String(process.env.REKIXO_PUBLIC_ORIGIN || "https://ar3dstudio.in").replace(/\/+$/, "");
const slug = String(process.env.REKIXO_FLOOR_UI_PROJECT_SLUG || "jyoti-paradise").trim();

test("live customer Building page renders and operates real floor-review buttons", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const floorDiagnostics: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.text().includes("[AR3D_FLOOR_RUNTIME]")) floorDiagnostics.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (/3Dprojects|\.glb(?:\?|$)|model/i.test(request.url()))
      failedRequests.push(request.url() + " :: " + (request.failure()?.errorText || "request failed"));
  });

  await page.addInitScript(() => {
    try { window.sessionStorage.setItem("ar3d.floorDebug", "1"); } catch { /* diagnostics are optional */ }
  });
  const pageUrl = origin + "/3Dprojects/" + encodeURIComponent(slug);
  const response = await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  expect(response, "Live customer page did not return a document").toBeTruthy();
  expect(response!.status(), "Live customer page returned an HTTP error").toBeLessThan(400);

  // Wait for the actual model to finish loading; the canvas alone exists before
  // the GLB/floor resolver is ready.
  try {
    await expect(page.locator(".viewer-loader")).toBeHidden({ timeout: 120_000 });
    await expect(page.locator(".viewer-canvas")).toBeVisible();
  } catch (error) {
    const state = await page.evaluate(() => ({
      title: document.title,
      bodyText: document.body.innerText.slice(0, 1_200),
      canvasCount: document.querySelectorAll(".viewer-canvas").length,
      loaderCount: document.querySelectorAll(".viewer-loader").length,
      floorNavCount: document.querySelectorAll('nav[aria-label="Select building floor"]').length,
    }));
    throw new Error(
      "Live 3D model did not become ready for floor review. state=" +
      JSON.stringify(state) +
      " pageErrors=" + JSON.stringify(pageErrors) +
      " failedRequests=" + JSON.stringify(failedRequests) +
      " floorDiagnostics=" + JSON.stringify(floorDiagnostics) +
      " cause=" + String(error),
    );
  }

  const floorNav = page.getByRole("navigation", { name: "Select building floor" });
  try {
    await expect(floorNav).toBeVisible({ timeout: 25_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 1_200),
      canvasCount: document.querySelectorAll(".viewer-canvas").length,
      floorNavCount: document.querySelectorAll('nav[aria-label="Select building floor"]').length,
      buttons: Array.from(document.querySelectorAll("button")).map((button) => ({
        text: button.textContent?.trim(),
        ariaLabel: button.getAttribute("aria-label"),
        visible: Boolean(button.getClientRects().length),
      })).filter((button) => button.visible).slice(0, 30),
    }));
    throw new Error(
      "Floor UI bundle is served but the live React viewer did not render floor controls. " +
      "state=" + JSON.stringify(state) +
      " pageErrors=" + JSON.stringify(pageErrors) +
      " failedRequests=" + JSON.stringify(failedRequests) +
      " floorDiagnostics=" + JSON.stringify(floorDiagnostics) +
      " cause=" + String(error),
    );
  }

  const expectedFloors = [
    ["Show Ground Floor only", "Ground"],
    ["Show Floor 1 only", "1F"],
    ["Show Floor 2 only", "2F"],
    ["Show Floor 3 only", "3F"],
    ["Show Floor 4 only", "4F"],
    ["Show Floor 5 only", "5F"],
  ];
  for (const [accessibleName] of expectedFloors) {
    await expect(
      floorNav.getByRole("button", { name: accessibleName }),
      "Missing required live floor button: " + accessibleName,
    ).toBeVisible();
  }
  await expect(floorNav.getByRole("button", { name: "Show roof only" })).toBeVisible();

  console.log(
    "LIVE_FLOOR_UI_RUNTIME: " + slug + " | buttons=" +
    JSON.stringify(await floorNav.locator("button").allTextContents()),
  );
  console.log("LIVE_FLOOR_RUNTIME_DIAGNOSTICS: " + JSON.stringify(floorDiagnostics));

  for (const accessibleName of ["Show Ground Floor only", "Show Floor 1 only", "Show Floor 5 only", "Show roof only"]) {
    const button = floorNav.getByRole("button", { name: accessibleName });
    await button.click();
    await expect(button, accessibleName + " should become active after click").toHaveAttribute("aria-pressed", "true");
  }
  await floorNav.getByRole("button", { name: "All", exact: true }).click();
  await expect(floorNav.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(pageErrors, "Browser errors while exercising live floor controls").toEqual([]);
});

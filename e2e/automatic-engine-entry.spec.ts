import { expect, test } from "@playwright/test";

const reviewPayload = {
  project: {
    id: "e2e-project-id",
    slug: "e2e-project",
    name: "Automatic Engine E2E",
    status: "draft",
  },
  authoritySuggestion: {
    status: "operator-review-required",
    sourceFileId: null,
    reason: "No verified source files yet.",
  },
  suggestions: [],
  latestPack: null,
  operatorApprovalRequired: true,
  immutableAfterSeal: true,
};

test("legacy Studio URL enters the Automatic Engine without exposing authoring UI", async ({
  page,
}) => {
  await page.route(
    "**/3Dprojects/api/cloud/projects/e2e-project/source-pack-review",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reviewPayload),
      }),
  );

  await page.goto("/3Dprojects/studio?project=e2e-project");

  await expect(page).toHaveURL(/\/3Dprojects\/source-pack\?project=e2e-project$/);
  await expect(page.getByText("Source Pack Review", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("AUTOMATIC ENGINE · INPUT WORKSPACE")).toBeVisible();
  await expect(page.getByText("One geometry authority", { exact: true })).toBeVisible();

  await expect(page.getByLabel("Smart 3D project builder")).toHaveCount(0);
  await expect(page.getByLabel("3D editor tools")).toHaveCount(0);
});

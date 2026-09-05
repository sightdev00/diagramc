import { expect, test } from "@playwright/test";

test("creates, renames, edits, and exports a diagram", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("DiagramC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "\u65b0\u5efa\u56fe" }).click();

  const title = page.getByLabel("\u56fe\u540d\u79f0");
  await title.fill("E2E Architecture");
  await title.press("Enter");
  await expect(title).toHaveValue("E2E Architecture");

  await page.locator("select.element-picker").selectOption("process");
  await page.getByRole("button", { name: "\uff0b \u6dfb\u52a0" }).click();
  await expect(page.getByRole("button", { name: "\u21b6 \u64a4\u9500" })).toBeEnabled();

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "\u5bfc\u51fa JSON" }).click(),
  ]);
  expect(download[0].suggestedFilename()).toMatch(/E2E Architecture.*\.json/);
});

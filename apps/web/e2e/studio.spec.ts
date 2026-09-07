import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
});

test.afterEach(async ({ page }, testInfo) => {
  const entries = (await page.coverage.stopJSCoverage()).filter((entry) =>
    entry.url.includes("/src/"),
  );
  const functions = entries.flatMap((entry) => entry.functions);
  const coveredFunctions = functions.filter((entry) =>
    entry.ranges.some((range) => range.count > 0),
  ).length;
  const coverage = {
    sourceEntries: entries.map((entry) => entry.url),
    functionCount: functions.length,
    coveredFunctions,
  };
  const coverageDirectory = join(process.cwd(), "e2e-coverage");
  await mkdir(coverageDirectory, { recursive: true });
  await writeFile(
    join(coverageDirectory, testInfo.testId.replace(/[^a-zA-Z0-9_-]/g, "-") + ".json"),
    JSON.stringify(coverage, null, 2),
  );
  await testInfo.attach("v8-source-coverage", {
    body: Buffer.from(JSON.stringify(coverage, null, 2)),
    contentType: "application/json",
  });
  expect(entries.some((entry) => entry.url.includes("/src/App.tsx"))).toBe(true);
  expect(coveredFunctions).toBeGreaterThan(0);
});

test("creates, renames, edits, and exports a diagram", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("DiagramC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "文件 ▾" }).click();
  await page.getByRole("button", { name: "新建图" }).click();

  const title = page.getByLabel("图名称");
  await title.fill("E2E Architecture");
  await title.press("Enter");
  await expect(title).toHaveValue("E2E Architecture");

  await page.locator("select.element-picker").selectOption("process");
  await page.getByRole("button", { name: "＋ 添加" }).click();
  await expect(page.getByRole("button", { name: "↶ 撤销" })).toBeEnabled();

  await page.getByRole("button", { name: "导出 ▾" }).click();
  const jsonDownload = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 JSON" }).click(),
  ]);
  expect(jsonDownload[0].suggestedFilename()).toMatch(/E2E Architecture.*\.json/);

  await page.getByRole("button", { name: "导出 ▾" }).click();
  const svgDownload = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 SVG" }).click(),
  ]);
  expect(svgDownload[0].suggestedFilename()).toMatch(/E2E Architecture.*\.svg/);

  await page.getByRole("button", { name: "导出 ▾" }).click();
  const pngDownload = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 PNG" }).click(),
  ]);
  expect(pngDownload[0].suggestedFilename()).toMatch(/E2E Architecture.*\.png/);
});

test("keeps document menus mutually exclusive and dismissible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "文件 ▾" }).click();
  await expect(page.locator("#file-menu")).toBeVisible();
  await page.getByRole("button", { name: "导入 ▾" }).click();
  await expect(page.locator("#file-menu")).toBeHidden();
  await expect(page.locator("#import-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#import-menu")).toBeHidden();
});

test("keeps top-bar menus inside a small viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  await page.goto("/");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;

  for (const [trigger, menu] of [
    ["文件 ▾", "#file-menu"],
    ["导入 ▾", "#import-menu"],
    ["导出 ▾", "#export-options"],
  ]) {
    await page.getByRole("button", { name: trigger }).click();
    const box = await page.locator(menu).boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
});

test("persists the selected interface theme", async ({ page }) => {
  await page.goto("/");
  const theme = page.getByLabel("界面主题");
  await theme.selectOption("contrast");
  await expect(page.locator(".studio-shell")).toHaveClass(/ui-contrast/);

  const title = page.getByLabel("图名称");
  await expect(title).toHaveCSS("background-color", "rgb(24, 57, 92)");
  await title.focus();
  await expect(title).toHaveCSS("color", "rgb(16, 24, 40)");
  await expect(title).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.reload();
  await expect(page.locator(".studio-shell")).toHaveClass(/ui-contrast/);

  await page.getByRole("button", { name: "导入 ▾" }).click();
  await expect(page.locator(".import-menu .svg-import-mode")).toBeVisible();
  await expect(page.locator(".import-menu .svg-import-mode")).toHaveCSS(
    "color",
    "rgb(16, 24, 40)",
  );
  await page.getByRole("button", { name: "粘贴 Mermaid 源码" }).click();
  await expect(page.getByRole("button", { name: "关闭源码导入" })).toHaveCSS(
    "color",
    "rgb(20, 38, 58)",
  );
});

test("deletes the last diagram from the list", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByRole("button", { name: "文件 ▾" }).click();
  await page.getByRole("button", { name: "删除当前图" }).click();

  await page.getByRole("button", { name: "文件 ▾" }).click();
  const switcher = page.getByLabel("切换图纸");
  await expect(switcher).toBeDisabled();
  await expect(switcher).toContainText("无图纸");
  await expect(page.getByLabel("图名称")).toBeDisabled();

  await page.reload();
  await page.getByRole("button", { name: "文件 ▾" }).click();
  await expect(switcher).toBeDisabled();
  await expect(switcher).toContainText("无图纸");

  await page.getByRole("button", { name: "新建图" }).click();
  await page.getByRole("button", { name: "文件 ▾" }).click();
  await expect(switcher).toBeEnabled();
  await expect(switcher.locator("option")).toHaveCount(1);
});

test("aligns selected nodes and supports keyboard nudging", async ({ page }) => {
  await page.goto("/");
  await page.locator("select.element-picker").selectOption("process");
  for (let index = 0; index < 3; index += 1)
    await page.getByRole("button", { name: "＋ 添加" }).click();

  await expect(page.locator(".x6-node")).toHaveCount(3);
  await page.getByRole("button", { name: "全选" }).click();
  const arrange = page.getByRole("button", { name: "排列 ▾" });
  await expect(arrange).toBeEnabled();
  await arrange.click();
  await page.getByRole("button", { name: "左对齐" }).click();
  await expect(page.locator(".toolbar-status")).toContainText("已对 3 个框左对齐");

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".toolbar-status")).toContainText("已微调 3 个框的位置");
});

test("shows resize handles for a selected node", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 添加" }).click();
  const node = page.locator(".x6-node").first();
  await expect(node).toBeVisible();
  await node.click();
  await expect(page.locator(".x6-widget-transform-resize")).toHaveCount(8);
  const rightHandle = page.locator(
    ".x6-widget-transform-resize[data-position=right]",
  );
  const box = await rightHandle.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2);
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByRole("spinbutton", { name: "宽度" }).inputValue())).toBeGreaterThan(220);
});

test("imports an editable Mermaid flowchart source", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入 ▾" }).click();
  await page.getByRole("button", { name: "粘贴 Mermaid 源码" }).click();

  await page.getByRole("textbox", { name: "Mermaid 源码" }).fill(`%% title: AI Flow
flowchart LR
  subgraph core[Core]
    A[Input] -->|valid| B{Check}
    B -.-> C[(Store)]
  end`);
  await page.getByRole("button", { name: "应用为新图" }).click();

  await expect(page.getByLabel("图名称")).toHaveValue("AI Flow");
  await expect(page.locator(".outline-relations button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Input" })).toBeVisible();
});

test("applies SVG source and reports sanitization diagnostics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入 ▾" }).click();
  await page.getByRole("button", { name: "粘贴 SVG 源码" }).click();

  await page.getByRole("textbox", { name: "SVG 源码" }).fill(`
    <svg viewBox="0 0 320 160" onload="alert(1)">
      <script>alert(1)</script>
      <rect x="20" y="20" width="180" height="70" fill="#cde8db" />
      <a href="https://example.com"><text x="30" y="65">AI SVG</text></a>
    </svg>
  `);
  await page.getByRole("button", { name: "应用为新图" }).click();

  await expect(page.getByLabel("图名称")).toHaveValue("AI SVG 源码");
  await page.getByRole("button", { name: "AI SVG 源码" }).click();
  await expect(page.getByText("源码诊断", { exact: true })).toBeVisible();
});

test("imports a structured SVG with markers as editable relations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入 ▾" }).click();
  await page.locator("select.svg-import-mode").selectOption("structured");
  await page.locator(`input[accept="image/svg+xml,.svg"]`).setInputFiles({
    name: "complex-diagram.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(`
      <svg viewBox="0 0 500 220" xmlns="http://www.w3.org/2000/svg">
        <defs><marker id="arrow" markerWidth="8" markerHeight="8"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
        <g transform="translate(20 15)">
          <rect id="source" x="10" y="30" width="130" height="64" rx="8" fill="#dbeafe" stroke="#2563eb" />
          <rect id="target" x="300" y="30" width="130" height="64" rx="8" fill="#dcfce7" stroke="#16a34a" />
          <path id="flow-arrow" d="M140 62 C190 62, 250 62, 300 62" stroke="#475569" fill="none" marker-end="url(#arrow)" />
          <text x="48" y="68">Source</text><text x="338" y="68">Target</text>
        </g>
      </svg>
    `),
  });

  await expect(page.getByLabel("图名称")).toHaveValue("complex-diagram");
  await expect(page.locator(".outline-node")).toHaveCount(2);
  await expect(page.locator(".outline-relations button")).toHaveCount(1);
});

test("imports DiagramC JSON and previews then reapplies AI commands", async ({ page }) => {
  await page.route("**/api/ai/commands", async (route) => {
    const request = route.request().postDataJSON() as { document: Record<string, unknown> };
    const candidate = structuredClone(request.document) as {
      document: { revision: number };
      elements: unknown[];
    };
    candidate.elements = [
      {
        id: "ai-review",
        kind: "node",
        semanticType: "flow.step",
        data: { label: "AI Review", shape: "rounded" },
        ports: [],
      },
    ];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        summary: "Add AI review",
        operations: [{ op: "element.create", element: candidate.elements[0] }],
        transaction: {
          transactionId: "e2e-ai",
          baseRevision: candidate.document.revision,
          actor: "ai",
          summary: "Add AI review",
          operations: [{ op: "element.create", element: candidate.elements[0] }],
        },
        document: candidate,
      }),
    });
  });
  await page.route("**/api/commands/replay", async (route) => {
    const request = route.request().postDataJSON() as { document: unknown };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        operations: [],
        transaction: { transactionId: "e2e-replay", baseRevision: 0, actor: "ai", operations: [] },
        document: request.document,
      }),
    });
  });
  await page.goto("/");
  await page.locator(`input[accept="application/json,.json"]`).setInputFiles({
    name: "imported.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: "2.0",
        document: { id: "e2e-import", title: "Imported E2E", diagramType: "flow", revision: 0 },
        elements: [], relations: [], constraints: [], layouts: {}, presentation: {}, assets: {}, extensions: {}, metadata: {},
      }),
    ),
  });
  await expect(page.getByLabel("图名称")).toHaveValue("Imported E2E");

  await page.getByRole("tab", { name: /AI/ }).click();
  await page.getByLabel("修改意图").fill("add a review step");
  await page.getByRole("button", { name: "生成命令预览" }).click();
  await expect(page.locator(".proposal-card strong")).toHaveText("Add AI review");
  await page.getByRole("button", { name: "应用事务" }).click();
  await expect(page.locator(".outline-node", { hasText: "AI Review" })).toBeVisible();
  await page.getByRole("button", { name: "重新应用" }).click();
  await expect(page.locator(".ai-status", { hasText: "已重新应用：Add AI review" })).toBeVisible();
});


test("supports keyboard dismissal and focus restoration for source import", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "导入 ▾" });
  await trigger.click();
  await page.getByRole("button", { name: "粘贴 Mermaid 源码" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mermaid 源码" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});

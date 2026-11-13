import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
test("another tab activating a new worker preserves drafts and the ledger", async ({
  page,
  context,
}) => {
  await page.goto("./");
  await expect(page.getByText("已可離線使用", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "加一個印", exact: true }).click();
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await page.getByRole("button", { name: "確認儲存", exact: true }).click();
  await expect(page.getByTestId("balance")).toHaveText("1個");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("顯示名稱").fill("更新時保留");
  await page.getByLabel("新增項目", { exact: true }).fill("另一份原因草稿");
  await expect(page.getByRole('button',{name:'停用',exact:true})).toBeDisabled();
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  const original = await readFile("dist/sw.js", "utf8");
  try {
    await writeFile("dist/sw.js", original + "\n// update test " + Date.now());
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });
    await expect(
      page.getByText("有新版本，重新開啟更新", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "立即更新" })).toBeDisabled();
    const other = await context.newPage();
    await other.goto("./");
    await other.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      reg.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () => !(await navigator.serviceWorker.ready).waiting,
        ),
      )
      .toBe(true);
    await expect(page.getByLabel("新增項目", { exact: true })).toHaveValue(
      "另一份原因草稿",
    );
    await expect(page.getByRole("button", { name: "立即更新" })).toBeDisabled();
    await page.getByRole("button", { name: "新增項目", exact: true }).click();
    await expect(page.getByRole("button", { name: "立即更新" })).toBeEnabled();
    await page.getByRole("button", { name: "立即更新" }).click();
    await expect(page.getByTestId("balance")).toHaveText("1個");
    await expect(
      page.getByRole("heading", { name: "更新時保留的星球" }),
    ).toBeVisible();
    await other.close();
  } finally {
    await writeFile("dist/sw.js", original);
  }
});

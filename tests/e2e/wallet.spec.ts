import { test, expect, type Page } from "@playwright/test";
async function award(page: Page, reason = "自己收拾玩具") {
  await page.getByRole("button", { name: "加一個印", exact: true }).click();
  await page.getByLabel("獎勵原因（選填）").fill(reason);
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await page.getByRole("button", { name: "確認儲存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("core flows persist, distinguish spending, reverse and render HTML as text", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByTestId("balance")).toHaveText("0個");
  await page.getByRole("button", { name: "扣一個印", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("目前沒有可扣的印仔", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await award(page);
  await award(page, "<script>window.hacked=true</script>");
  await expect(page.getByTestId("balance")).toHaveText("2個");
  await page.getByRole("button", { name: "扣一個印", exact: true }).click();
  await page.getByLabel("扣印原因", { exact: true }).fill("忘記收拾");
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await expect(page.getByText("餘額 2 → 1 個")).toBeVisible();
  await page.getByRole("button", { name: "確認儲存", exact: true }).click();
  await expect(page.getByTestId("balance")).toHaveText("1個");
  await page.getByRole("button", { name: "消費印仔", exact: true }).click();
  await page.getByLabel("消費數量").fill("2");
  await page.getByLabel("消費用途", { exact: true }).fill("小貼紙");
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await expect(page.getByRole("alert")).toContainText("差 1");
  await expect(page.getByLabel("消費用途", { exact: true })).toHaveValue(
    "小貼紙",
  );
  await page.getByLabel("消費數量").fill("1");
  await page.getByLabel("使用日期時間（香港）").fill("2026-11-12T09:30");
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await page.getByRole("button", { name: "確認儲存", exact: true }).click();
  await expect(page.getByTestId("balance")).toHaveText("0個");
  await page.reload();
  await expect(page.getByTestId("balance")).toHaveText("0個");
  await page.getByRole("button", { name: "歷史", exact: true }).click();
  const row = page
    .locator("li")
    .filter({ has: page.getByText("小貼紙", { exact: true }) })
    .last();
  await row.locator("summary").click();
  await expect(row).toContainText("記錄後餘額");
  await row.getByRole("button", { name: "撤銷這筆紀錄" }).click();
  await page.getByRole("button", { name: "確認全額撤銷" }).click();
  await expect(page.getByText("消費退回", { exact: true })).toBeVisible();
  await expect(
    page
      .locator("section:not([hidden])")
      .getByText("<script>window.hacked=true</script>", { exact: true })
      .first(),
  ).toBeVisible();
  expect(await page.evaluate(() => "hacked" in window)).toBe(false);
  await page.getByRole("button", { name: "印仔卡", exact: true }).click();
  await expect(page.getByTestId("balance")).toHaveText("1個");
});
test("settings, target redemption, reason management, backup round trip and child mode", async ({
  page,
}) => {
  await page.goto("./");
  await award(page);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("顯示名稱").fill("測試星星");
  await page.getByLabel("目標名稱").fill("一起看星星");
  await page.getByLabel("目標印仔數量").fill("1");
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "設定已儲存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "改名", exact: true }).click();
  await page.getByLabel("改名", { exact: true }).fill("收拾書包");
  await page.getByRole("button", { name: "儲存名稱" }).click();
  await page.getByRole("button", { name: "停用", exact: true }).click();
  await expect(page.getByText("收拾書包（已停用）")).toBeVisible();
  await page.getByRole("button", { name: "啟用", exact: true }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出目前資料", exact: true }).click();
  const download = await dl;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByRole("button", { name: "印仔卡", exact: true }).click();
  await expect(page.getByText("可以兌換！")).toBeVisible();
  await page.getByRole("button", { name: "兌換此目標" }).click();
  await expect(page.getByLabel("消費用途", { exact: true })).toHaveValue(
    "一起看星星",
  );
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await page.getByRole("button", { name: "確認儲存", exact: true }).click();
  await expect(page.getByTestId("balance")).toHaveText("0個");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("選取 JSON 備份").setInputFiles(path!);
  await page.getByLabel("我已保留所需備份，確認取代目前資料").check();
  await page.getByRole("button", { name: "確認取代並還原" }).click();
  await expect(page.getByRole("alert")).toContainText("資料已變更");
  // Export current revision, preview again, then explicitly confirm replacement.
  await page.getByRole("button", { name: "匯出目前資料", exact: true }).click();
  await page.getByLabel("選取 JSON 備份").setInputFiles(path!);
  await page.getByLabel("我已保留所需備份，確認取代目前資料").check();
  await page.getByRole("button", { name: "確認取代並還原" }).click();
  await expect(page.getByTestId("balance")).toHaveText("1個");
  await page.getByRole("button", { name: "小朋友展示" }).click();
  await expect(
    page.getByRole("button", { name: "加一個印", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("balance")).toBeVisible();
  await page.getByRole("button", { name: "返回家長模式" }).click();
  await expect(
    page.getByRole("button", { name: "加一個印", exact: true }),
  ).toBeVisible();
});
test("production offline cold navigation and reconnect never duplicate entries", async ({
  page,
  context,
}) => {
  await page.goto("./");
  await expect(page.getByText("已可離線使用", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await award(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("balance")).toHaveText("1個");
  await award(page, "離線記錄");
  await expect(page.getByTestId("balance")).toHaveText("2個");
  await page.getByRole('button',{name:'扣一個印',exact:true}).click();
  await page.getByLabel('扣印原因',{exact:true}).fill('離線扣印');
  await page.getByRole('button',{name:'下一步：確認'}).click();
  await page.getByRole('button',{name:'確認儲存',exact:true}).click();
  await expect(page.getByTestId('balance')).toHaveText('1個');
  await page.getByRole('button',{name:'消費印仔',exact:true}).click();
  await page.getByLabel('消費用途',{exact:true}).fill('離線兌換');
  await page.getByRole('button',{name:'下一步：確認'}).click();
  await page.getByRole('button',{name:'確認儲存',exact:true}).click();
  await expect(page.getByTestId('balance')).toHaveText('0個');
  await page.getByRole('button',{name:'歷史',exact:true}).click();
  const row=page.locator('section:not([hidden]) li').filter({hasText:'離線兌換'});
  await row.locator('summary').click();
  await row.getByRole('button',{name:'撤銷這筆紀錄'}).click();
  await page.getByRole('button',{name:'確認全額撤銷'}).click();
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByLabel('新增項目',{exact:true}).fill('離線新增原因');
  await page.getByRole('button',{name:'新增項目',exact:true}).click();
  await expect(page.getByText('離線新增原因',{exact:true})).toBeVisible();
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'匯出目前資料',exact:true}).click();
  expect((await downloaded).suggestedFilename()).toMatch(/stamp-wallet-backup/);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByTestId("balance")).toHaveText("1個");
});
test("mobile geometry, long text, keyboard focus, draft retained across pages", async ({
  page,
}, info) => {
  await page.goto("./");
  await expect(page.getByTestId("balance")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${info.project.name}-home.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("顯示名稱").fill("尚未儲存的名稱");
  await page.getByRole("button", { name: "歷史", exact: true }).click();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByLabel("顯示名稱")).toHaveValue("尚未儲存的名稱");
  await page.getByRole("button", { name: "印仔卡", exact: true }).click();
  await page.getByRole("button", { name: "加一個印", exact: true }).click();
  await page.getByLabel("獎勵原因（選填）").fill("長".repeat(101));
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await expect(page.getByRole("alert")).toContainText("100");
  await page.getByLabel("獎勵原因（選填）").fill("長".repeat(100));
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await page.screenshot({
    path: `test-results/${info.project.name}-form.png`,
    fullPage: true,
  });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("draft survives child display and old reversal form rejects a changed dataset", async ({
  page,
  context,
}) => {
  await page.goto("./");
  await award(page);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("顯示名稱").fill("未儲存草稿");
  await page.getByRole("button", { name: "小朋友展示" }).click();
  await page.getByRole("button", { name: "返回家長模式" }).click();
  await expect(page.getByLabel("顯示名稱")).toHaveValue("未儲存草稿");
  await page.getByRole("button", { name: "歷史", exact: true }).click();
  await page.locator("section:not([hidden]) summary").click();
  await page.getByRole("button", { name: "撤銷這筆紀錄" }).click();
  const other = await context.newPage();
  await other.goto("./");
  await other.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("stamp-wallet");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("meta", "readwrite");
        const table = tx.objectStore("meta");
        const get = table.get("main");
        get.onsuccess = () =>
          table.put({
            ...get.result,
            datasetGeneration: crypto.randomUUID(),
            revision: get.result.revision + 1,
          });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await other.reload();
  await award(other, "新世代");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "確認全額撤銷" }).click();
  await expect(page.getByRole("alert")).toContainText("重新載入");
  await other.close();
});
test("failed storage preserves draft and retry posts exactly once", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByTestId("balance")).toHaveText("0個");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (
      ...args: Parameters<IDBObjectStore["add"]>
    ) {
      if (this.name === "entries") {
        IDBObjectStore.prototype.add = original;
        throw new DOMException("測試寫入失敗", "QuotaExceededError");
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "加一個印", exact: true }).click();
  await page.getByLabel("獎勵原因（選填）").fill("失敗保留");
  await page.getByRole("button", { name: "下一步：確認" }).click();
  await page.getByRole("button", { name: "確認儲存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("未能儲存");
  await expect(page.getByLabel("獎勵原因（選填）")).toHaveValue("失敗保留");
  await page.getByRole("button", { name: "確認儲存", exact: true }).click();
  await expect(page.getByTestId("balance")).toHaveText("1個");
  await page.reload();
  await expect(page.getByTestId("balance")).toHaveText("1個");
});
test("two real tabs racing to spend cannot overdraw", async ({
  page,
  context,
}) => {
  await page.goto("./");
  await award(page);
  const other = await context.newPage();
  await other.goto("./");
  for (const p of [page, other]) {
    await expect(p.getByTestId("balance")).toHaveText("1個");
    await p.getByRole("button", { name: "消費印仔", exact: true }).click();
    await p.getByLabel("消費用途", { exact: true }).fill("同時兌換");
    await p.getByRole("button", { name: "下一步：確認" }).click();
  }
  await Promise.all(
    [page, other].map((p) =>
      p.getByRole("button", { name: "確認儲存", exact: true }).click(),
    ),
  );
  await expect
    .poll(
      async () =>
        (await page.getByRole("dialog").count()) +
        (await other.getByRole("dialog").count()),
    )
    .toBe(1);
  const failed = (await page.getByRole("dialog").count()) ? page : other;
  await expect(failed.getByRole("alert")).toContainText("差 1");
  await page.reload();
  await expect(page.getByTestId("balance")).toHaveText("0個");
  await other.close();
});

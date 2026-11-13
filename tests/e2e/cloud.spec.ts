import { test, expect } from "@playwright/test";
test("password rejection preserves input and local wallet without sending mail", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://*.supabase.co/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      status: 400,
      headers: {
        "x-supabase-api-version": "2024-01-01",
        "access-control-expose-headers": "X-Supabase-Api-Version",
      },
      contentType: "application/json",
      body: JSON.stringify({
        code: "invalid_credentials",
        msg: "Invalid login credentials",
      }),
    });
  });
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "爸爸媽媽家庭同步", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page
    .getByRole("button", { name: "爸爸媽媽家庭同步", exact: true })
    .click();
  await page.getByLabel("電郵", { exact: true }).fill("parent@example.com");
  await page.getByLabel("密碼", { exact: true }).fill("Synthetic-password-123");
  await expect(page.getByLabel("密碼", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("電郵或密碼不正確");
  await expect(page.getByLabel("電郵", { exact: true })).toHaveValue(
    "parent@example.com",
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("/token?grant_type=password");
  await page.getByRole("button", { name: "返回本機戶口" }).click();
  await expect(
    page.getByRole("button", { name: "加一個印", exact: true }),
  ).toBeVisible();
});
test("precreated password account reaches family setup and can sign out", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://*.supabase.co/**", async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url.includes("/token?grant_type=password")) {
      expect(route.request().postDataJSON()).toMatchObject({
        email: "parent@example.com",
        password: "Synthetic-password-123",
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "test-token",
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_in: 3600,
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "parent@example.com",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      });
    } else if (url.includes("/rpc/family_current"))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      });
    else if (url.includes("/logout")) await route.fulfill({ status: 204 });
    else await route.abort();
  });
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "爸爸媽媽家庭同步", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page
    .getByRole("button", { name: "爸爸媽媽家庭同步", exact: true })
    .click();
  await page.getByLabel("電郵", { exact: true }).fill("parent@example.com");
  await page.getByLabel("密碼", { exact: true }).fill("Synthetic-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "建立家庭", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登入", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("密碼", { exact: true })).toHaveValue("");
  expect(
    requests.some((u) => u.includes("/otp") || u.includes("/signup")),
  ).toBe(false);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain("Synthetic-password");
});

test("owner deletion requires confirmation, rejects stale preview, then returns to join screen", async ({
  page,
}) => {
  const userId = "11111111-1111-4111-8111-111111111111";
  let deleted = false;
  let attempts = 0;
  const backup = {
    appId: "stamp-wallet",
    formatVersion: 1,
    databaseSchemaVersion: 1,
    exportedAt: new Date().toISOString(),
    wallet: { id: "main", nickname: "測試家庭", balance: 0, lastSequence: 0 },
    settings: {
      id: "main",
      goalName: "小小心願",
      goalAmount: 10,
      language: "zh-HK",
      timeZone: "Asia/Hong_Kong",
    },
    meta: {
      id: "main",
      databaseSchemaVersion: 1,
      datasetGeneration: "test-generation",
      revision: 0,
    },
    entries: [],
    reasons: [],
  };
  const family = {
    familyId: "22222222-2222-4222-8222-222222222222",
    role: "owner",
    members: [{ userId, label: "媽媽", role: "owner" }],
    backup,
  };
  await page.route("https://*.supabase.co/**", async (route) => {
    const url = route.request().url();
    let data: unknown;
    let status = 200;
    if (url.includes("/token?grant_type=password"))
      data = {
        access_token: "test-token",
        refresh_token: "test-refresh",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          id: userId,
          email: "parent@example.com",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      };
    else if (url.includes("/family_current")) data = deleted ? null : family;
    else if (url.includes("/family_delete")) {
      attempts++;
      expect(route.request().postDataJSON()).toMatchObject({
        p_family_id: family.familyId,
        p_generation: "test-generation",
        p_revision: 0,
        p_confirmation: "刪除家庭",
      });
      if (attempts === 1) {
        status = 400;
        data = { message: "其他家長已修改資料，請重新預覽及備份" };
      } else {
        deleted = true;
        data = true;
      }
    } else return route.abort();
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page
    .getByRole("button", { name: "爸爸媽媽家庭同步", exact: true })
    .click();
  await page.getByLabel("電郵", { exact: true }).fill("parent@example.com");
  await page.getByLabel("密碼", { exact: true }).fill("Synthetic-password-123");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "預覽刪除家庭" }).click();
  const remove = page.getByRole("button", {
    name: "永久刪除此家庭",
    exact: true,
  });
  await expect(remove).toBeDisabled();
  await page.getByLabel("我已保留所需備份", { exact: false }).check();
  await page.getByLabel("輸入「刪除家庭」確認").fill("刪除家庭");
  await remove.click();
  await expect(page.getByRole("alert")).toContainText("其他家長已修改");
  await expect(remove).toBeVisible();
  expect(deleted).toBe(false);
  await page.getByRole("button", { name: "重新預覽", exact: true }).click();
  await expect(remove).toBeDisabled();
  await page.getByLabel("我已保留所需備份", { exact: false }).check();
  await page.getByLabel("輸入「刪除家庭」確認").fill("刪除家庭");
  await remove.click();
  await expect(
    page.getByRole("button", { name: "加入家庭", exact: true }),
  ).toBeVisible();
  expect(deleted).toBe(true);
});

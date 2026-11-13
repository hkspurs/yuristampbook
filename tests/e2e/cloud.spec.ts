import { test, expect } from "@playwright/test";
test("family login preserves local wallet and reports a rejected email request", async ({
  page,
}) => {
  await page.route("https://*.supabase.co/**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: "over_email_send_rate_limit",
        msg: "測試：寄送失敗，請稍後重試",
      }),
    }),
  );
  await page.goto("./");
  await page
    .getByRole("button", { name: "爸爸媽媽家庭同步", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "爸爸媽媽家庭同步" }),
  ).toBeVisible();
  await page.getByLabel("電郵", { exact: true }).fill("parent@example.com");
  await page.getByRole("button", { name: "寄送登入驗證碼" }).click();
  await expect(page.getByRole("alert")).toContainText("寄送失敗");
  await expect(page.getByLabel("電郵", { exact: true })).toHaveValue(
    "parent@example.com",
  );
  await page.getByRole("button", { name: "返回本機戶口" }).click();
  await expect(
    page.getByRole("button", { name: "加一個印", exact: true }),
  ).toBeVisible();
});
test("OTP request displays code form without sending real mail", async ({
  page,
}) => {
  await page.route("https://*.supabase.co/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.goto("./");
  await page
    .getByRole("button", { name: "爸爸媽媽家庭同步", exact: true })
    .click();
  await page.getByLabel("電郵", { exact: true }).fill("parent@example.com");
  await page.getByRole("button", { name: "寄送登入驗證碼" }).click();
  await expect(page.getByLabel("電郵驗證碼")).toBeVisible();
  await expect(page.getByLabel("電郵", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重新寄送／修改電郵" }).click();
  await expect(page.getByLabel("電郵", { exact: true })).toBeEnabled();
});

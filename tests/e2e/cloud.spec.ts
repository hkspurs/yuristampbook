import { test, expect } from "@playwright/test";
test("password rejection preserves input and local wallet without sending mail", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://*.supabase.co/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      status: 400,
      headers: { "x-supabase-api-version": "2024-01-01", "access-control-expose-headers": "X-Supabase-Api-Version" },
      contentType: "application/json",
      body: JSON.stringify({
        code: "invalid_credentials",
        msg: "Invalid login credentials",
      }),
    });
  });
  await page.goto("./");
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

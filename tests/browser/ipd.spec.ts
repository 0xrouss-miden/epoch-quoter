import { test, expect, type Page } from "@playwright/test";
import { ETH, USDT } from "../fixtures/ipd";
const direction = `${ETH}:${USDT}`;
const row = (page: Page) => page.locator(`tr[data-direction="${direction}"]`);
async function complete(page: Page) {
  await expect(page.getByRole("status").first()).toContainText(
    "directions checked",
  );
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4419/__control", { data: {} });
});

test("all advisory states, exact partial proceeds, keyboard details and narrow layout", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/epoch/ipd");
  await complete(page);
  for (const text of [
    "Estimated full fill",
    "No executable liquidity",
    "Estimated partial fill",
    "Waiting for price move",
    "Settlement delayed",
    "Check failed",
  ])
    await expect(page.locator(".ipd-status", { hasText: text })).toHaveCount(1);
  await expect(page.getByLabel("IPD auto-refresh")).toHaveValue("0");
  await page.getByRole("button", { name: "Details for WBTC to USDT" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Unfilled:")).toContainText("0.0005 WBTC");
  await expect(page.getByText("Unfilled:")).toContainText(
    "Partial execution pays the note’s own ratio",
  );
  await page
    .getByRole("button", { name: "Details for WBTC to USDT" })
    .press("Enter");
  await page.screenshot({ path: "artifacts/ipd/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/ipd/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Details for ETH to USDT", exact: true }),
  ).toBeVisible();
  await page.getByText("What this estimate covers", { exact: true }).click();
  await expect(
    page.getByText(/maker offering 10 tokens all-or-nothing/),
  ).toBeVisible();
  const stats = await (
    await request.get("http://127.0.0.1:4419/__stats")
  ).json();
  expect(stats.peak).toBeLessThanOrEqual(2);
  expect(
    stats.calls.every((call: { method: string }) => call.method === "GET"),
  ).toBe(true);
  expect(
    stats.calls.filter((call: { path: string }) => call.path === "/v1/prices"),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("amount/policy edits rebuild exact requests, filter scans and reject obsolete results", async ({
  page,
  request,
}) => {
  await page.goto("/epoch/ipd");
  await complete(page);
  await page.getByLabel("Amount preset", { exact: true }).selectOption("1");
  await complete(page);
  const small = await row(page)
    .getByLabel("Offered amount for ETH to USDT", { exact: true })
    .inputValue();
  await page.getByLabel("Amount preset", { exact: true }).selectOption("100");
  await complete(page);
  const large = await row(page)
    .getByLabel("Offered amount for ETH to USDT", { exact: true })
    .inputValue();
  expect(small).toBe("0.01");
  expect(large).toBe("1");
  await page.getByLabel("Filter by offered asset").selectOption(ETH);
  await complete(page);
  await expect(page.locator("tr[data-direction]")).toHaveCount(2);
  await request.post("http://127.0.0.1:4419/__control", {
    data: { delayEtaMs: 700, scenario: "full" },
  });
  const amount = row(page).getByLabel("Offered amount for ETH to USDT", {
    exact: true,
  });
  await amount.fill("2");
  await expect(page.getByRole("status").first()).toContainText("Checking");
  await amount.fill("3");
  await expect(row(page).locator(".ipd-full")).toHaveCount(0);
  await complete(page);
  await expect(amount).toHaveValue("3");
  await page
    .getByRole("button", { name: "Details for ETH to USDT", exact: true })
    .click();
  await page.getByText("Exact request and solver response").click();
  await expect(page.locator(".raw-details pre")).toContainText(
    '"offeredAmount": "300000000"',
  );
  await page.getByText("Limit policy · 5 bps").click();
  await page.getByLabel("Slippage in basis points").fill("101");
  await expect(page.locator(".error-banner[role=alert]")).toContainText(
    "1 to 100",
  );
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeDisabled();
});

test("missing valuation permits a custom amount and a failed refresh immediately removes green", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4419/__control", {
    data: { missingValuation: true, scenario: "full" },
  });
  await page.goto("/epoch/ipd");
  await complete(page);
  await expect(row(page)).toContainText("Price unavailable");
  await row(page)
    .getByLabel("Offered amount for ETH to USDT", { exact: true })
    .fill("1");
  await complete(page);
  await expect(row(page)).toContainText("Estimated full fill");
  await page.route("**/api/ipd/scan", (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/html",
      body: "<html>offline</html>",
    }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row(page).locator(".ipd-full")).toHaveCount(0);
  await expect(row(page)).toContainText("Check failed");
});

test("expiry, visibility, pause and auto-refresh cannot present old observations as current", async ({
  page,
  request,
}) => {
  await page.clock.install();
  await page.goto("/epoch/ipd");
  await page.clock.runFor(500);
  await complete(page);
  await page.clock.fastForward(121000);
  await expect(page.locator(".ipd-full")).toHaveCount(0);
  await expect(row(page)).toContainText("Stale observation");
  await page.clock.setSystemTime(new Date());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await complete(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(row(page)).toContainText("Stale observation");
  const before = (
    await (await request.get("http://127.0.0.1:4419/__stats")).json()
  ).calls.length;
  await page.getByLabel("IPD auto-refresh").selectOption("60");
  await page.clock.fastForward(61000);
  expect(
    (await (await request.get("http://127.0.0.1:4419/__stats")).json()).calls
      .length,
  ).toBe(before);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Paused · page hidden",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(61000);
  expect(
    (await (await request.get("http://127.0.0.1:4419/__stats")).json()).calls
      .length,
  ).toBe(before);
  await page.clock.setSystemTime(new Date());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await complete(page);
  const completed = (
    await (await request.get("http://127.0.0.1:4419/__stats")).json()
  ).calls.length;
  await page.clock.fastForward(60001);
  await complete(page);
  expect(
    (await (await request.get("http://127.0.0.1:4419/__stats")).json()).calls
      .length,
  ).toBeGreaterThan(completed);
});

test("Epoch navigation and quote request defaults survive under /epoch", async ({
  page,
}) => {
  const sent: { routeId: string; amount: string }[] = [];
  await page.route("**/api/quote", async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    await route.fulfill({
      json: {
        routeId: body.routeId,
        requestedAmount: body.amount,
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        durationMs: 1,
        message: "Fixture: no quote",
      },
    });
  });
  await page.goto("/epoch");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Development Strict Mode may cancel and restart the first four jobs.
  await expect
    .poll(() => new Set(sent.map((body) => body.routeId)).size)
    .toBe(20);
  expect(sent.every((body) => ["100", "0.01"].includes(body.amount))).toBe(
    true,
  );
  await page.getByRole("link", { name: "IPD", exact: true }).click();
  await expect(page).toHaveURL(/\/epoch\/ipd$/);
  await page.getByRole("link", { name: "Epoch", exact: true }).click();
  await expect(page).toHaveURL(/\/epoch$/);
});

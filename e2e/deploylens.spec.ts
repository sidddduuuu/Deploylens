import { expect, test } from "@playwright/test";

const canonicalQuestion = "Why did checkout conversion drop around 14:20?";
const mobileFollowUp = "Show only mobile traffic";
const chatUrl = /\/app\?chat=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("the landing page is responsive and product-backed", async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ height: 900, width });
    await page.goto("/");
    await expect(page.getByRole("heading", {
      name: /Ask why the metric moved\. Get the incident, not a paragraph\./,
    })).toBeVisible();
    await expect(page.getByRole("link", { name: "Investigate an incident" })).toBeVisible();
    await expect(page.getByText(/Fixture preview · checkout-2026-07-20-1420/)).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  }
});

test("the credential-free incident card is linked, responsive, and refresh-stable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Investigate an incident" }).click();
  await expect(page).toHaveURL(chatUrl);
  const investigationUrl = page.url();

  await expect(page.getByRole("heading", { name: "Investigate a metric movement" })).toBeVisible();
  await expect(page.getByRole("region", { name: "How DeployLens works" })).toBeVisible();
  await expect(page.getByText("Sample checkout incident", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Ask about checkout")).toHaveValue(canonicalQuestion);
  await expect(page.getByRole("button", { name: "Run sample investigation" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText(/Example result.*no live investigation has run yet/i);
  await expect(page.getByText(/Fixture preview · checkout-2026-07-20-1420/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Release 1\.8\.3 caused/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Incident timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checkout funnel" })).toBeVisible();

  const segmentTable = page.getByRole("table", {
    name: "Conversion change across all 24 scanned segments",
  });
  await expect(segmentTable.getByRole("button")).toHaveCount(24);

  const affectedSegment = page.getByRole("button", {
    name: /^1\.8\.3, EU-West, mobile:/,
  });
  const conversionLine = page.locator(".lane-conversionRate polyline");
  const aggregateConversionPoints = await conversionLine.getAttribute("points");
  expect(aggregateConversionPoints).not.toBeNull();
  await affectedSegment.focus();
  await expect(affectedSegment).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(affectedSegment).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status", { name: "Evidence scope update" }))
    .toContainText("Filtered to 1.8.3 / EU-West / mobile");
  await expect(page.locator(".evidence-toolbar").getByText("1.8.3 / EU-West / mobile", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /timeline for 1\.8\.3 \/ EU-West \/ mobile/ }))
    .toBeVisible();
  await expect(conversionLine).not.toHaveAttribute("points", aggregateConversionPoints!);
  const purchaseRow = page
    .getByLabel("Scrollable funnel comparison")
    .getByRole("row", { name: /^Purchase/ });
  await expect(purchaseRow.getByText("616", { exact: true })).toBeVisible();

  const allTraffic = page.getByRole("button", { name: "All traffic" });
  await allTraffic.click();
  await expect(page.getByText("All checkout traffic", { exact: true })).toBeVisible();
  await expect(affectedSegment).toHaveAttribute("aria-pressed", "false");
  await expect(allTraffic).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status", { name: "Evidence scope update" }))
    .toContainText("Showing all checkout traffic");
  await expect(conversionLine).toHaveAttribute("points", aggregateConversionPoints!);
  await expect(purchaseRow.getByText("684", { exact: true })).toBeVisible();

  const question = page.getByLabel("Ask about checkout");
  await question.fill("What changed?");
  await expect(page.getByRole("button", { name: "Investigate" })).toBeVisible();
  await page.getByRole("button", { name: "Investigate" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ask about the seeded checkout" }))
    .toContainText("filter it to mobile traffic");

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ height: 900, width });
    await page.reload();
    await expect(page).toHaveURL(investigationUrl);
    await expect(page.getByRole("heading", { name: "Investigate a metric movement" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run sample investigation" })).toBeInViewport();
    await expect(page.getByRole("heading", { name: /Release 1\.8\.3 caused/ })).toBeVisible();
    if (width === 390) {
      await expect(page.getByText("Scroll horizontally to compare devices.")).toBeVisible();
    }
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  }

  const chatId = new URL(investigationUrl).searchParams.get("chat");
  expect(chatId).not.toBeNull();
  await page.evaluate(({ key, resume }) => {
    window.sessionStorage.setItem(key, JSON.stringify(resume));
  }, {
    key: `deploylens:chat:${chatId}:resume`,
    resume: {
      question: canonicalQuestion,
      session: { isStreaming: false, publicAccessToken: "credential-free-test-token" },
    },
  });
  await page.reload();
  await expect(page.getByRole("log").getByText(canonicalQuestion, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Reconnecting to this investigation" })).toHaveCount(0);
  await page.evaluate(({ key, resume }) => {
    window.sessionStorage.setItem(key, JSON.stringify(resume));
  }, {
    key: `deploylens:chat:${chatId}:resume`,
    resume: {
      question: canonicalQuestion,
      session: { isStreaming: true, publicAccessToken: "credential-free-test-token" },
    },
  });
  await page.reload();
  await expect(page.getByRole("log").getByText(canonicalQuestion, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reconnecting to this investigation" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("@live the deployed conversation survives refresh and refines one incident", async ({ page }) => {
  test.skip(
    process.env.RUN_CREDENTIALED_E2E !== "1",
    "set RUN_CREDENTIALED_E2E=1 and configure the deployed services",
  );
  test.setTimeout(420_000);
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    expect(
      process.env.TRIGGER_SECRET_KEY?.trim(),
      "TRIGGER_SECRET_KEY is required for the local live browser proof",
    ).toBeTruthy();
  }

  await page.goto("/app");
  await expect(page).toHaveURL(chatUrl);
  const investigationUrl = page.url();
  const question = page.getByLabel("Ask about checkout");
  await expect(question).toHaveValue(canonicalQuestion);
  const runSample = page.getByRole("button", { name: "Run sample investigation" });
  await runSample.focus();
  await expect(runSample).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("log").getByText(canonicalQuestion, { exact: true })).toHaveCount(1);

  const progress = page.getByRole("region", { name: "Analysis progress" });
  await expect(progress.getByText("running", { exact: true }).first()).toBeVisible({ timeout: 180_000 });
  const chatId = new URL(investigationUrl).searchParams.get("chat");
  expect(chatId).not.toBeNull();
  await expect.poll(() => page.evaluate(({ expectedQuestion, key }) => {
    const stored = window.sessionStorage.getItem(key);
    if (!stored) return false;
    const resume = JSON.parse(stored) as { question?: unknown; session?: { isStreaming?: unknown } };
    return resume.question === expectedQuestion && resume.session?.isStreaming === true;
  }, {
    expectedQuestion: canonicalQuestion,
    key: `deploylens:chat:${chatId}:resume`,
  })).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(investigationUrl);

  const liveIncident = page.getByText(/Live incident · checkout-2026-07-20-1420/);
  await expect(liveIncident).toBeVisible({ timeout: 180_000 });
  const incidentLabel = await liveIncident.textContent();
  expect(incidentLabel).not.toBeNull();
  await expect(page.getByRole("heading", { name: /Release 1\.8\.3 caused/ })).toBeVisible();
  await expect(progress).toContainText("Rendering incident");

  await page.getByRole("button", { name: /^1\.8\.3, EU-West, mobile:/ }).click();
  await expect(page.locator(".evidence-toolbar").getByText("1.8.3 / EU-West / mobile", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: mobileFollowUp }).click();
  await expect(question).toHaveValue(mobileFollowUp);
  await page.getByRole("button", { name: "Investigate" }).click();
  await expect(page.getByText("All mobile checkout traffic", { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByText(incidentLabel!, { exact: true })).toBeVisible();
  await expect(page.locator("article.evidence-pane")).toHaveCount(1);
});

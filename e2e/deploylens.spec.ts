import { expect, test } from "@playwright/test";

const canonicalQuestion = "Why did checkout conversion drop around 14:20?";
const mobileFollowUp = "Show only mobile traffic";
const chatUrl = /\?chat=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("the credential-free incident card is linked, responsive, and refresh-stable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(chatUrl);
  const investigationUrl = page.url();

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
  await affectedSegment.click();
  await expect(affectedSegment).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("1.8.3 / EU-West / mobile", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /timeline for 1\.8\.3 \/ EU-West \/ mobile/ }))
    .toBeVisible();
  await expect(conversionLine).not.toHaveAttribute("points", aggregateConversionPoints!);
  const purchaseRow = page
    .getByLabel("Scrollable funnel comparison")
    .getByRole("row", { name: /^Purchase/ });
  await expect(purchaseRow.getByText("616", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "All traffic" }).click();
  await expect(page.getByText("All checkout traffic", { exact: true })).toBeVisible();

  const question = page.getByLabel("Ask about checkout");
  await question.fill("What changed?");
  await page.getByRole("button", { name: "Investigate" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ask about the seeded checkout" }))
    .toContainText("filter it to mobile traffic");

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ height: 900, width });
    await page.reload();
    await expect(page).toHaveURL(investigationUrl);
    await expect(page.getByRole("heading", { name: "Checkout conversion" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Release 1\.8\.3 caused/ })).toBeVisible();
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
  await expect(page.getByRole("log").getByText(canonicalQuestion, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Building the incident evidence" })).toBeVisible();
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

  await page.goto("/");
  await expect(page).toHaveURL(chatUrl);
  const investigationUrl = page.url();
  const question = page.getByLabel("Ask about checkout");
  await expect(question).toHaveValue(canonicalQuestion);
  await page.getByRole("button", { name: "Investigate" }).click();

  const progress = page.getByRole("status").filter({ hasText: "Analysis progress" });
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
  await expect(page.getByText("1.8.3 / EU-West / mobile", { exact: true })).toBeVisible();

  await question.fill(mobileFollowUp);
  await page.getByRole("button", { name: "Investigate" }).click();
  await expect(page.getByText("All mobile checkout traffic", { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByText(incidentLabel!, { exact: true })).toBeVisible();
  await expect(page.locator("article.evidence-pane")).toHaveCount(1);
});

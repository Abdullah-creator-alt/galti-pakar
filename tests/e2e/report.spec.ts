import { assertClean, expect, loadBundle, seedBundle, setTheme, test } from "./helpers";
import type { Page } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

async function open(page: Page, name: string) {
  const b = loadBundle(name);
  await seedBundle(page, b);
  await page.goto(`/report/${b.report.id}`);
  await expect(page.locator("h1")).toBeVisible();
  return b;
}

test.describe("degraded bundles leave no empty shells", () => {
  test("no examiners: plain note, no empty agreement tile, no AI runs heading", async ({ page, problems }) => {
    await open(page, "no-examiners");
    await expect(page.getByText("AI examiner opinion unavailable, scores use measurements only.")).toBeVisible();
    await expect(page.getByText("AI runs agree")).toHaveCount(0);
    await expect(page.getByText(/AI runs? scored this/)).toHaveCount(0);
    assertClean(problems);
  });

  test("identical rewrite: no Before/after panel, a note instead", async ({ page, problems }) => {
    await open(page, "rewrite-identical");
    await expect(page.getByText(/No model paragraph this time/)).toBeVisible();
    await expect(page.getByText("A stronger version")).toHaveCount(0);
    assertClean(problems);
  });

  test("real degraded response: neutral banner, notes collapsed, drift note instead of chart", async ({ page, problems }) => {
    await open(page, "real-degraded");
    await expect(page.getByText("Some checks were unavailable for this analysis.")).toBeVisible();
    await expect(page.getByText(/Topic drift could not be measured/)).toBeVisible();
    const notes = page.locator("details", { hasText: "Notes about this analysis" });
    await expect(notes).toBeVisible();
    expect(await notes.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await expect(page.getByText("Top-essay benchmark")).toHaveCount(0);
    assertClean(problems);
  });

  test("benchmark unavailable: no benchmark section", async ({ page, problems }) => {
    await open(page, "benchmark-unavailable");
    await expect(page.getByText("Top-essay benchmark")).toHaveCount(0);
    assertClean(problems);
  });

  test("8 long warnings sit in one collapsed list", async ({ page, problems }) => {
    await open(page, "long-warnings");
    const notes = page.locator("details", { hasText: "Notes about this analysis (8)" });
    await expect(notes).toBeVisible();
    await notes.locator("summary").click();
    await expect(notes.locator("li")).toHaveCount(8);
    assertClean(problems);
  });

  for (const name of ["empty-trace", "no-extras"]) {
    test(`${name}: highlights open with a reason and no trace section`, async ({ page, problems }) => {
      await open(page, name);
      await page.locator(".hl").first().click();
      await expect(page.getByText("How we found this")).toHaveCount(0);
      assertClean(problems);
    });
  }

  test("poor legibility: banner and uncertain-word marks", async ({ page, problems }) => {
    await open(page, "poor-legibility");
    await expect(page.locator(".uncertain").first()).toBeVisible();
    assertClean(problems);
  });

  test("link out of range: the trace shows but there is no jump button", async ({ page, problems }) => {
    await open(page, "link-out-of-range");
    await page.locator("#span-p2-523-588").click();
    const panel = page.getByRole("complementary", { name: "Why this passage was marked" });
    await expect(panel.getByText("How we found this")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Show the linked passage" })).toHaveCount(0);
    assertClean(problems);
  });

  test("3,000-word essay renders and scrolls without sideways overflow", async ({ page, problems }) => {
    await open(page, "very-long");
    await expect(page.locator(".hl")).toHaveCount(48);
    assertClean(problems);
  });
});

test.describe("highlight interaction", () => {
  test("desktop: reason first, then the trace chain; the linked passage scrolls and flashes", async ({ page, problems }) => {
    await setTheme(page, "light");
    await open(page, "full");
    await page.locator("#span-p2-523-588").click();
    const panel = page.getByRole("complementary", { name: "Why this passage was marked" });
    const reason = panel.locator("p").filter({ hasText: /\w{4,}/ }).first();
    const how = panel.getByText("How we found this");
    await expect(how).toBeVisible();
    const [ry, hy] = [(await reason.boundingBox())!.y, (await how.boundingBox())!.y];
    expect(ry).toBeLessThan(hy);
    await panel.getByRole("button", { name: "Show the linked passage" }).click();
    await expect(page.locator(".flash-passage").first()).toBeVisible();
    const inView = await page.locator("#span-p3-163-237").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    expect(inView).toBe(true);
    assertClean(problems);
  });

  test("phone: keyboard opens the sheet, Escape closes it and focus returns to the passage", async ({ page, problems }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "full");
    const span = page.locator("#span-p2-523-588");
    await span.scrollIntoViewIfNeeded();
    await span.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Why this passage was marked" });
    await expect(sheet).toBeVisible();
    // The sheet must not cover the whole screen, and its buttons must be at least 44 px tall.
    const box = (await sheet.boundingBox())!;
    expect(box.height).toBeLessThan(844 * 0.8);
    for (const b of await sheet.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(span).toBeFocused();
    assertClean(problems);
  });

  test("touch targets on the report page are at least 44 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "full");
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll("button, a[href]").forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.height < 43.5 && getComputedStyle(el).display !== "inline") bad.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.height)}px`);
      });
      return bad;
    });
    expect(small).toEqual([]);
  });
});

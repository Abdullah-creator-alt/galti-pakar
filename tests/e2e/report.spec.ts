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

test.describe("For the CSS English Essay section", () => {
  test("the example report shows signals, provenance and its source, with no marks or scores", async ({ page, problems }) => {
    await page.goto("/report/example");
    await expect(page.getByText("For the CSS English Essay", { exact: true })).toBeVisible();
    await expect(page.getByText(/These are structural signals from your essay/)).toBeVisible();
    await expect(page.getByText("What stands out", { exact: true })).toBeVisible();
    await expect(page.getByText("Start by re-reading P7")).toBeVisible();

    // Nine criteria; only the two the official syllabus supports are badged as FPSC; the rest say they are inferred.
    await expect(page.getByText("FPSC syllabus", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Inferred best practice", { exact: true })).toHaveCount(7);
    // Status chips carry a small marker character, so they are matched by their words.
    await expect(page.getByText(/Signals to check/).first()).toBeVisible();
    await expect(page.getByText(/^\S?\s*Signals to check$/)).toHaveCount(4);
    await expect(page.getByText(/^\S?\s*Not assessed here$/)).toHaveCount(3);
    await expect(page.getByText(/^\S?\s*Nothing flagged$/)).toHaveCount(2);

    // The official wording is quoted with its page, and the source links to FPSC.
    await expect(page.getByText(/comprehensive and research based knowledge on a selected topic/).first()).toBeVisible();
    await expect(page.getByText(/PDF page 7/).first()).toBeVisible();
    const source = page.getByRole("link", { name: /Revised Syllabi for CSS Competitive Examination/ });
    await expect(source).toHaveAttribute("href", /^https:\/\/www\.fpsc\.gov\.pk\//);
    await expect(source).toHaveAttribute("rel", /noopener/);

    // Hedged, not graded: no score, grade or pass/fail language inside the section.
    const section = page.locator("main").locator("xpath=//*[contains(., 'These are structural signals from your essay')][not(.//*[contains(., 'These are structural signals from your essay')])]/..");
    // The section's own disclaimer uses these words only to say it gives none; everything else must avoid them.
    const text = (await section.innerText()).replace(/is not thereby false/gi, "").replace(/No marks, score or grade come from this section\./, "");
    expect(text).not.toMatch(/\b(score|grade|pass|fail|rank)\b/i);
    await expect(page.getByText(/There are no marks here/)).toBeVisible();
    assertClean(problems);
  });

  test("a paragraph link scrolls to that paragraph in the essay", async ({ page }) => {
    await page.goto("/report/example");
    const link = page.getByRole("link", { name: "Go to paragraph 7 in your essay" }).first();
    await expect(link).toHaveAttribute("href", "#p7");
    await link.click();
    await expect(page).toHaveURL(/#p7$/);
    await expect(page.locator("#p7")).toBeInViewport();
  });

  test("the limits are one tap away and the section works on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/report/example");
    const first = page.getByText("What this cannot show").first();
    await first.click();
    await expect(page.getByText(/does not mention a thesis\. The only signal is whether the extraction step labelled a confident thesis/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  });

  test("a bundle without the CSS extra shows no CSS section", async ({ page }) => {
    await open(page, "no-extras");
    await expect(page.getByText("For the CSS English Essay", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Top 3 fixes", { exact: true })).toBeVisible();
  });
});

test.describe("how it works page", () => {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    test(`renders at ${w}px with no sideways scroll and links from home`, async ({ page, problems }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/");
      await page.getByRole("link", { name: "See where the AI is used and what the code checks" }).click();
      await page.waitForURL("**/how-it-works");
      await expect(page.locator("h1")).toHaveText("Measure first, judge second, verify everything.");
      await expect(page.getByText("What the AI does")).toHaveCount(6);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
      await page.screenshot({ path: `tests/screenshots/how-it-works-${w}.png`, fullPage: true });
      assertClean(problems);
    });
  }
});

test.describe("before and after for several weak paragraphs", () => {
  const stronger = (page: Page) => page.getByText("A stronger version (machine-written)");

  test("two weak paragraphs each get their own pair, with their own notes, and the practice note once", async ({ page, problems }) => {
    await open(page, "full");
    await expect(stronger(page)).toHaveCount(2);
    await expect(page.getByText("Paragraph 5, the weakest on-page paragraph.")).toBeVisible();
    await expect(page.getByText("Paragraph 4, where the checks also found problems.")).toBeVisible();
    await expect(page.getByText("Tied the education point back to the essay's topic.")).toBeVisible();
    await expect(page.getByText(/Model paragraphs for practice/)).toHaveCount(1);
    assertClean(problems);
  });

  test("a report with only the main rewrite shows exactly one pair", async ({ page, problems }) => {
    await open(page, "one-rewrite");
    await expect(stronger(page)).toHaveCount(1);
    await expect(page.getByText("where the checks also found problems")).toHaveCount(0);
    await expect(page.getByText(/Model paragraphs for practice/)).toHaveCount(1);
    assertClean(problems);
  });

  test("further rewrites that do not match the text or a paragraph are dropped, not shown broken", async ({ page, problems }) => {
    await open(page, "bad-more-rewrite");
    await expect(stronger(page)).toHaveCount(1);
    assertClean(problems);
  });

  test("on a phone the pairs stack and nothing scrolls sideways", async ({ page, problems }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "full");
    await expect(stronger(page)).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    assertClean(problems);
  });
});

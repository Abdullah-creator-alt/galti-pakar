import { assertClean, expect, hasHorizontalScroll, loadBundle, seedBundle, setTheme, test, validFixtures } from "./helpers";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
];
const THEMES = ["light", "dark"] as const;

// Reduced motion makes the scroll reveals show at once, so full-page screenshots capture every section.
test.use({ reducedMotion: "reduce" });

for (const name of ["example", ...validFixtures]) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`report ${name} at ${vp.name} (${theme}): clean console, no sideways scroll, screenshot`, async ({ page, problems }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setTheme(page, theme);
        let id = "example";
        if (name !== "example") {
          const b = loadBundle(name);
          id = b.report.id;
          await seedBundle(page, b);
        }
        await page.goto(`/report/${id}`);
        await expect(page.getByText("Essay report", { exact: true })).toBeVisible();
        await expect(page.locator("h1")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(theme);
        expect(await hasHorizontalScroll(page), "page scrolls sideways").toBe(false);
        await page.screenshot({ path: `tests/screenshots/${name}-${vp.name}-${theme}.png`, fullPage: true });
        assertClean(problems);
      });
    }
  }
}

// Well-formedness and reference checks for the generated .pptx (no PowerPoint needed).
import JSZip from "jszip";
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const zip = await JSZip.loadAsync(readFileSync("deck/Galti-Pakar-AICON26.pptx"));
const browser = await chromium.launch();
const page = await browser.newPage();
let bad = 0;
for (let i = 1; i <= 5; i++) {
  const xml = await zip.file(`ppt/slides/slide${i}.xml`).async("string");
  const r = await page.evaluate((x) => {
    const d = new DOMParser().parseFromString(x, "application/xml");
    const err = d.querySelector("parsererror");
    if (err) return { error: err.textContent.slice(0, 200) };
    const ids = [...d.querySelectorAll("cNvPr")].map((e) => e.getAttribute("id"));
    const targets = [...d.querySelectorAll("spTgt")].map((e) => e.getAttribute("spid"));
    const ctn = [...d.querySelectorAll("cTn")].map((e) => e.getAttribute("id"));
    return { dupShapeIds: ids.length - new Set(ids).size, missingTargets: targets.filter((t) => !ids.includes(t)).length, dupTimingIds: ctn.length - new Set(ctn).size, animations: d.querySelectorAll("cTn[presetID]").length, order: [...d.documentElement.children].map((c) => c.localName).join(">") };
  }, xml);
  console.log(`slide${i}`, JSON.stringify(r));
  if (r.error || r.dupShapeIds || r.missingTargets || r.dupTimingIds) bad++;
}
const notes = Object.keys(zip.files).filter((f) => f.startsWith("ppt/notesSlides/") && f.endsWith(".xml")).length;
console.log("notes slides:", notes, "| problems:", bad);
await browser.close();
process.exit(bad ? 1 : 0);

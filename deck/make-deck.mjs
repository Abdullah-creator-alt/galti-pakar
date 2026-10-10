/**
 * Builds the AICON'26 demo deck: 5 slides, light and minimal, native editable shapes, real PowerPoint animations.
 * One slide spec feeds two renderers: pptxgenjs (the .pptx) and a small HTML preview (for checking the layout).
 *
 *   node deck/capture.mjs          (needs the app on localhost:3000; refreshes deck/img/*.png)
 *   node deck/make-deck.mjs        writes deck/Galti-Pakar-AICON26.pptx and deck/preview/*.html
 *
 * Every number in the deck comes from the repository (README.md, data/*-eval.json, docs/JUDGING-AUDIT.md).
 */
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = "deck/Galti-Pakar-AICON26.pptx";
const IMG = (n) => path.resolve("deck/img", n);

/* ---------- design tokens: the product's own colours, on cool paper ---------- */
const C = {
  paper: "F4F8F6", white: "FFFFFF", ink: "0C1F1C", muted: "586C68", faint: "8DA09C", hair: "D3E0DC",
  teal: "0F766E", tealMid: "14A89A", tealWash: "DDF1ED", tealDeep: "0A4F4A",
  green: "1F8A55", greenWash: "DDF3E6", amber: "D9930A", amberWash: "FBEFC9", amberText: "7A5200",
  red: "D14343", redWash: "FADDDD", redText: "8F1F1F",
};
const F = { display: "Segoe UI Semibold", body: "Segoe UI", mono: "Consolas" };
const W = 13.333, H = 7.5;

/* ---------- spec helpers ---------- */
let slides = [];
const S = (bg = C.paper) => { const s = { els: [], notes: "", bg }; slides.push(s); return s; };
const add = (s, el) => (s.els.push(el), el);
const run = (text, o = {}) => ({ text, ...o });

/** A text box; with `shape`, a filled/outlined shape that holds the text. */
const T = (s, name, x, y, w, h, runs, o = {}) => add(s, { t: "text", name, x, y, w, h, runs: Array.isArray(runs) ? runs : [run(runs)], align: "left", valign: "top", margin: 0, ...o });
const mono = (s, name, x, y, w, text, color = C.teal, o = {}) => T(s, name, x, y, w, 0.3, [run(text, { font: F.mono, size: 10.5, bold: true, color, spacing: 1.5 })], o);
const L = (s, name, x1, y1, x2, y2, o = {}) => add(s, { t: "line", name, x1, y1, x2, y2, color: C.faint, lw: 1.25, ...o });
const I = (s, name, file, x, y, w, h, o = {}) => add(s, { t: "img", name, file, x, y, w, h, ...o });
const card = (s, name, x, y, w, h, o = {}) => add(s, { t: "text", name, x, y, w, h, runs: [run("")], shape: { fill: C.white, line: C.hair, lw: 1, radius: 0.12, ...(o.shape ?? {}) }, ...o, margin: 0 });

function chrome(s, n, title, kicker) {
  mono(s, "kicker", 0.7, 0.5, 9, kicker);
  T(s, "title", 0.7, 0.82, 11.9, 0.9, title, { anim: { fx: "rise", at: 150, dur: 600 } });
  L(s, "foot-rule", 0.7, 7.0, W - 0.7, 7.0, { color: C.hair, lw: 0.75 });
  T(s, "foot-l", 0.7, 7.08, 8, 0.25, [run("GALTI PAKAR  ·  AICON'26 BUILD WITH AI  ·  EDTECH & WORKFORCE", { font: F.mono, size: 8.5, color: C.faint, spacing: 1 })]);
  T(s, "foot-r", W - 2.7, 7.08, 2, 0.25, [run(`${n} / 5`, { font: F.mono, size: 8.5, color: C.faint, spacing: 1 })], { align: "right" });
}
const title = (a, b) => [run(a, { font: F.display, size: 34, color: C.ink }), ...(b ? [run(b, { font: F.display, size: 34, color: C.teal })] : [])];

/* =====================================================================================================
   SLIDE 1: the problem, and the product in one picture
   ===================================================================================================== */
{
  const s = S();
  s.notes = "The problem. Only 2.77 percent of CSS candidates passed the written exam in 2025, and FPSC officials told the Senate that most fail English Essay because their arguments lack logical structure. Feedback today means a tutor or an academy: slow, expensive, mostly in big cities. Galti Pakar reads a photo of a handwritten essay and shows exactly where each mark is lost. On the right is the idea in one picture: every passage is marked, and every mark has a reason. This is a labelled sample, not a real analysis.";
  mono(s, "kicker", 0.7, 0.5, 9, "AICON'26  ·  BUILD WITH AI  ·  EDTECH & WORKFORCE", C.teal, { anim: { fx: "fade", at: 0, dur: 500 } });
  T(s, "h1a", 0.7, 0.95, 7.2, 0.7, [run("Find where your essay", { font: F.display, size: 42, color: C.ink })], { anim: { fx: "rise", at: 200, dur: 600 } });
  T(s, "h1b", 0.7, 1.65, 7.2, 0.7, [run("loses marks.", { font: F.display, size: 42, color: C.ink })], { anim: { fx: "rise", at: 380, dur: 600 } });
  T(s, "h1c", 0.7, 2.35, 7.2, 0.7, [run("Before the examiner does.", { font: F.display, size: 42, color: C.teal })], { anim: { fx: "rise", at: 560, dur: 600 } });

  T(s, "stat", 0.7, 3.5, 3.3, 1.5, [run("2.77%", { font: F.display, size: 80, color: C.ink })], { anim: { fx: "zoom", at: 1100, dur: 700 } });
  T(s, "stat-a", 4.15, 3.72, 3.7, 0.8, [run("of 12,792 candidates passed the CSS 2025 written exam.", { size: 16, color: C.ink })], { anim: { fx: "fade", at: 1600, dur: 600 } });
  T(s, "stat-b", 4.15, 4.5, 3.7, 0.95, [run("FPSC to the Senate: most fail English Essay. Arguments lack logical structure.", { size: 12.5, color: C.muted })], { anim: { fx: "fade", at: 2000, dur: 600 } });
  T(s, "stat-src", 0.7, 5.55, 7.2, 0.3, [run("Sources: Daily Pakistan, 22 Aug 2025 (results). ProPakistani, 5 Jun 2025 (FPSC to the Senate).", { size: 9, color: C.faint })], { anim: { fx: "fade", at: 2300, dur: 600 } });

  add(s, { t: "text", name: "pitch", x: 0.7, y: 6.05, w: 7.25, h: 0.62, runs: [run("Photograph a handwritten essay. Get every mark explained.", { font: F.display, size: 15, color: C.white })], shape: { fill: C.teal, radius: 0.31 }, margin: 18, valign: "middle", anim: { fx: "rise", at: 2700, dur: 600 } });

  // the marked page
  card(s, "paper", 8.25, 0.85, 4.45, 3.85, { shape: { fill: C.white, line: C.hair, lw: 1, radius: 0.14, shadow: true }, anim: { fx: "fade", at: 500, dur: 600 } });
  mono(s, "paper-label", 8.55, 1.05, 4.0, "SAMPLE PASSAGE  ·  NOT A REAL ANALYSIS", C.faint, { anim: { fx: "fade", at: 700, dur: 500 } });
  T(s, "p-s1", 8.55, 1.5, 3.85, 0.7, [run("Pakistan faces many problems, and water is one of them.", { size: 15, color: C.ink, hl: C.amberWash, ul: { style: "dash", color: C.amber } })], { anim: { fx: "wipeL", at: 1400, dur: 700 } });
  T(s, "p-s2", 8.55, 2.3, 3.85, 1.1, [run("The Indus Basin Irrigation System loses roughly a third of its water before it reaches a field.", { size: 15, color: C.ink, hl: C.greenWash, ul: { style: "sng", color: C.green } })], { anim: { fx: "wipeL", at: 2300, dur: 800 } });
  T(s, "p-s3", 8.55, 3.55, 3.85, 0.7, [run("Everybody knows something must be done.", { size: 15, color: C.ink, hl: C.redWash, ul: { style: "wavy", color: C.red } })], { anim: { fx: "wipeL", at: 3300, dur: 700 } });

  add(s, { t: "text", name: "callout", x: 8.55, y: 4.95, w: 4.15, h: 0.95, runs: [run("OFF-TOPIC OR UNSUPPORTED", { font: F.mono, size: 9.5, bold: true, color: C.redText, spacing: 1.2, br: true }), run("A claim with no sentence that backs it up. Tap any mark to see why.", { size: 11.5, color: C.muted })], shape: { fill: C.white, line: C.red, lw: 1.25, radius: 0.1, shadow: true }, margin: 11, anim: { fx: "rise", at: 4100, dur: 600 } });
  T(s, "callout-pulse-anchor", 0.01, 0.01, 0.01, 0.01, [run("")], { anim: undefined });
  T(s, "leg1", 8.25, 6.1, 1.0, 0.3, [run("Strong", { size: 11, color: C.ink, hl: C.greenWash, ul: { style: "sng", color: C.green } })], { anim: { fx: "fade", at: 4600, dur: 400 } });
  T(s, "leg2", 9.3, 6.1, 1.6, 0.3, [run("Weak or generic", { size: 11, color: C.ink, hl: C.amberWash, ul: { style: "dash", color: C.amber } })], { anim: { fx: "fade", at: 4750, dur: 400 } });
  T(s, "leg3", 11.0, 6.1, 1.9, 0.3, [run("Off-topic", { size: 11, color: C.ink, hl: C.redWash, ul: { style: "wavy", color: C.red } })], { anim: { fx: "fade", at: 4900, dur: 400 } });
  s.els = s.els.filter((e) => e.name !== "callout-pulse-anchor");
  s.els.find((e) => e.name === "callout").pulseAt = 5200;
  L(s, "foot-rule", 0.7, 7.0, W - 0.7, 7.0, { color: C.hair, lw: 0.75 });
  T(s, "foot-l", 0.7, 7.08, 8, 0.25, [run("GALTI PAKAR  ·  github.com/Abdullah-creator-alt/galti-pakar", { font: F.mono, size: 8.5, color: C.faint, spacing: 1 })]);
  T(s, "foot-r", W - 2.7, 7.08, 2, 0.25, [run("1 / 5", { font: F.mono, size: 8.5, color: C.faint, spacing: 1 })], { align: "right" });
}

/* =====================================================================================================
   SLIDE 2: the solution, in the shape the rulebook asks for, with the real product
   ===================================================================================================== */
{
  const s = S();
  s.notes = "The solution, in the structure the rulebook asks for: problem, input, AI component, output, impact. The input is just phone photos. The AI step is the heart, which the next slide opens up. And the output is what you see here: every highlight opens its reason and how it was found, seven rubric scores, and a before-and-after for every weak paragraph. These are real screenshots of the running app, using the example report, which is labelled as sample data.";
  chrome(s, 2, title("A photo in. ", "Explained marks out."), "THE SOLUTION  ·  PROBLEM → INPUT → AI → OUTPUT → IMPACT");
  const chips = [
    ["PROBLEM", "Essays fail on argument structure", false],
    ["INPUT", "Phone photos of handwriting", false],
    ["AI", "Reads, measures, examines, coaches", true],
    ["OUTPUT", "Marked essay, 7 scores, fixes", false],
    ["IMPACT", "Specific feedback in about a minute", false],
  ];
  const cw = 2.1, gap = 0.33, x0 = 0.7;
  chips.forEach(([k, v, ai], i) => {
    const x = x0 + i * (cw + gap);
    add(s, { t: "text", name: `chip${i}`, x, y: 1.75, w: cw, h: 0.82, runs: [run(k, { font: F.mono, size: 9.5, bold: true, color: ai ? "CFEFEA" : C.teal, spacing: 1.5, br: true }), run(v, { size: 11.5, color: ai ? C.white : C.ink, bold: ai })], shape: { fill: ai ? C.teal : C.white, line: ai ? C.teal : C.hair, lw: 1, radius: 0.1 }, margin: 10, valign: "middle", anim: { fx: "wipeL", at: 500 + i * 420, dur: 450 } });
    if (i < 4) L(s, `arrow${i}`, x + cw + 0.04, 2.16, x + cw + gap - 0.04, 2.16, { color: C.teal, lw: 1.5, arrow: true, anim: { fx: "fade", at: 800 + i * 420, dur: 300 } });
  });
  s.els.find((e) => e.name === "chip2").pulseAt = 3200;

  // real screenshots
  const lx = 0.7, ly = 3.05;
  mono(s, "lab1", lx, ly - 0.32, 5, "WHERE EXACTLY", C.teal, { anim: { fx: "fade", at: 2300, dur: 400 } });
  card(s, "shot1-bg", lx, ly, 6.0, 2.98, { shape: { fill: C.white, line: C.hair, lw: 1, radius: 0.08, shadow: true }, anim: { fx: "rise", at: 2300, dur: 700 } });
  I(s, "shot1", "essay-trace.png", lx + 0.06, ly + 0.06, 5.88, 2.86, { anim: { fx: "rise", at: 2300, dur: 700 } });
  const rx = 7.0, rw = 5.63;
  mono(s, "lab2", rx, ly - 0.32, 5, "WHY", C.teal, { anim: { fx: "fade", at: 3000, dur: 400 } });
  card(s, "shot2-bg", rx, ly, rw, 1.15, { shape: { fill: C.white, line: C.hair, lw: 1, radius: 0.08, shadow: true }, anim: { fx: "rise", at: 3000, dur: 700 } });
  I(s, "shot2", "scorecard.png", rx + 0.06, ly + 0.06, rw - 0.12, (rw - 0.12) * 402 / 2112, { anim: { fx: "rise", at: 3000, dur: 700 } });
  mono(s, "lab3", rx, ly + 1.27, 5, "WHAT TO FIX", C.teal, { anim: { fx: "fade", at: 3700, dur: 400 } });
  const bh = (rw - 0.12) * 628 / 2112;
  card(s, "shot3-bg", rx, ly + 1.55, rw, bh + 0.12, { shape: { fill: C.white, line: C.hair, lw: 1, radius: 0.08, shadow: true }, anim: { fx: "rise", at: 3700, dur: 700 } });
  I(s, "shot3", "before-after.png", rx + 0.06, ly + 1.61, rw - 0.12, bh, { anim: { fx: "rise", at: 3700, dur: 700 } });
  T(s, "shot-note", 0.7, 6.18, 6.0, 0.7, [run("Real screenshots of the running app, using the built-in example report (sample data, labelled as such in the app).", { size: 10.5, color: C.muted })], { anim: { fx: "fade", at: 4500, dur: 500 } });
}

/* =====================================================================================================
   SLIDE 3: the AI pipeline as a flowchart: what the AI does, what the code checks
   ===================================================================================================== */
{
  const s = S();
  s.notes = "This is the core. Six AI steps, and under each one, the code that checks it. One: Gemini vision reads the handwriting and flags the words it is unsure of. Two: embeddings turn the topic, paragraphs and sentences into meaning vectors. Three, in parallel: Gemini labels each sentence's role, our own trained classifier scores how generic each sentence is, and the vectors measure topic drift. Four: two separate examiner runs score seven rubric dimensions, and every quote must exist in the essay or it is dropped. Five is plain code, not a model: it blends measurement and examiner, and lists every disagreement. Six: the coach explains the three most important fixes and rewrites up to three weak paragraphs, but code decides which ones. If any step fails the report says which check was unavailable. It never guesses.";
  chrome(s, 3, title("Six AI steps. ", "Every answer checked by code."), "HOW THE AI IS INTEGRATED");
  const x0 = 1.95, nw = 1.58, ng = 0.2, ay = 2.45, ah = 1.62, cy = 4.62, ch = 1.2;
  const colx = (i) => x0 + i * (nw + ng);
  // lanes
  add(s, { t: "text", name: "lane-ai", x: 0.7, y: 1.95, w: 11.95, h: 2.35, runs: [run("")], shape: { fill: C.tealWash, radius: 0.14 }, anim: { fx: "fade", at: 0, dur: 600 } });
  add(s, { t: "text", name: "lane-code", x: 0.7, y: 4.4, w: 11.95, h: 1.65, runs: [run("")], shape: { fill: C.white, line: C.hair, lw: 1, radius: 0.14 }, anim: { fx: "fade", at: 150, dur: 600 } });
  T(s, "lane-ai-l", 0.9, 2.45, 1.0, 1.0, [run("AI", { font: F.display, size: 26, color: C.teal, br: true }), run("proposes", { font: F.mono, size: 9.5, color: C.teal })], { anim: { fx: "fade", at: 300, dur: 500 } });
  T(s, "lane-code-l", 0.9, 4.75, 1.0, 1.0, [run("Code", { font: F.display, size: 22, color: C.ink, br: true }), run("verifies", { font: F.mono, size: 9.5, color: C.muted })], { anim: { fx: "fade", at: 450, dur: 500 } });
  mono(s, "in-label", x0, 1.58, 3, "PHOTOS + TOPIC  →", C.muted, { anim: { fx: "fade", at: 300, dur: 400 } });
  T(s, "out-label", W - 3.7, 1.58, 3.05, 0.3, [run("→  REPORT", { font: F.mono, size: 10.5, bold: true, color: C.teal, spacing: 1.5 })], { align: "right", anim: { fx: "fade", at: 6300, dur: 400 } });

  const ai = [
    ["1  Read", "Vision turns photos into paragraphs and flags words it is unsure of.", "gemini-3.6-flash", false],
    ["2  Embed", "Meaning vectors for the topic, paragraphs and sentences.", "gemini-embedding-001", false],
    ["3  Measure", "Sentence roles, genericness and topic drift, in parallel.", "flash + our classifier", false],
    ["4  Examine", "Two runs score 7 rubric dimensions and must quote the essay.", "gemini-3.6-flash  ×2", false],
    ["5  Blend", "No model here. Rules blend measured and examiner scores.", "plain code", true],
    ["6  Coach", "Explains 3 fixes, rewrites up to 3 weak paragraphs.", "gemini-3.6-flash", false],
  ];
  const code = [
    "Schema check. Unsure words shown with a dotted underline.",
    "One shared cache. Max 95 texts; extras shown as unassessed.",
    "Rules link claims to evidence and colour each sentence.",
    "A quote not in the essay is dropped. Band computed in code.",
    "40% measured + 60% examiner. Every conflict is listed.",
    "Code picks the paragraphs. Invented figures become slots.",
  ];
  const t = (i) => 700 + i * 700;
  ai.forEach(([h, d, m, none], i) => {
    add(s, { t: "text", name: `ai${i}`, x: colx(i), y: ay, w: nw, h: ah, runs: [
      run(h, { font: F.display, size: 14, color: none ? C.muted : C.ink, br: true }),
      run(d, { size: 10, color: C.muted, br: true }),
      run(m, { font: F.mono, size: 7.5, bold: true, color: none ? C.faint : C.teal, spacing: 0.6 }),
    ], shape: { fill: none ? C.paper : C.white, line: none ? C.faint : C.teal, lw: none ? 1 : 1.5, dash: none ? "dash" : undefined, radius: 0.1, shadow: !none }, margin: 8, valign: "top", anim: { fx: "rise", at: t(i), dur: 550 } });
    if (i < 5) L(s, `flow${i}`, colx(i) + nw + 0.01, ay + ah / 2, colx(i + 1) - 0.01, ay + ah / 2, { color: C.teal, lw: 1.75, arrow: true, anim: { fx: "wipeL", at: t(i) + 380, dur: 300 } });
    L(s, `drop${i}`, colx(i) + nw / 2, ay + ah + 0.02, colx(i) + nw / 2, cy - 0.02, { color: none ? C.faint : C.teal, lw: 1.25, dash: "dash", anim: { fx: "wipeD", at: 4900 + i * 260, dur: 260 } });
    add(s, { t: "text", name: `code${i}`, x: colx(i), y: cy, w: nw, h: ch, runs: [run(code[i], { size: 10, color: C.ink })], shape: { fill: C.paper, line: C.hair, lw: 1, radius: 0.08 }, margin: 8, valign: "middle", anim: { fx: "rise", at: 5050 + i * 260, dur: 450 } });
  });
  s.els.find((e) => e.name === "ai3").pulseAt = 6800;
  add(s, { t: "text", name: "failsafe", x: 0.7, y: 6.3, w: 11.95, h: 0.5, runs: [run("If a step fails, the report says which check was unavailable. It never guesses.", { font: F.display, size: 12.5, color: C.ink })], shape: { fill: C.amberWash, radius: 0.25 }, margin: 16, valign: "middle", anim: { fx: "rise", at: 6900, dur: 500 } });
}

/* =====================================================================================================
   SLIDE 4: why the AI is meaningful, not generic: one highlight traced, and proof it is checked
   ===================================================================================================== */
{
  const s = S();
  s.notes = "Why this is meaningful AI, not a chatbot on an app. On the left is one highlight traced end to end: the passage, how it was read, labelled, linked to evidence by meaning, which rule turned it amber, and the verification that both passages exist. Teal steps are AI, outlined steps are code. On the right, proof that the AI is checked: two independent examiner runs with disagreements shown; in one test run one of eleven quotes was invented and caught; and a genericness classifier we trained ourselves, on synthetic data, which we say plainly. The AI never sets the band, never picks what to fix, and never invents a figure. Remove the AI and the product is gone: no handwriting reading, no measuring of meaning.";
  chrome(s, 4, title("AI that has to ", "prove its work."), "WHY IT IS MEANINGFUL, NOT GENERIC");
  mono(s, "trace-h", 0.7, 1.95, 7, "ONE HIGHLIGHT, TRACED END TO END", C.muted, { anim: { fx: "fade", at: 300, dur: 400 } });
  add(s, { t: "text", name: "quote", x: 0.7, y: 2.35, w: 7.2, h: 0.78, runs: [run("…the shock travels outward to mills, traders and urban food prices", { size: 15.5, color: C.ink, hl: C.amberWash, ul: { style: "dash", color: C.amber } })], shape: { fill: C.white, line: C.hair, lw: 1, radius: 0.1, shadow: true }, margin: 14, valign: "middle", anim: { fx: "wipeL", at: 700, dur: 700 } });
  const steps = [
    ["READ", "Handwriting read as part of paragraph 2", "ai"],
    ["LABEL", "Labelled as a claim", "ai"],
    ["LINK", "Nearest evidence by meaning: 0.52", "ai"],
    ["RULE", "0.45 to 0.60 counts as a weak link", "code"],
    ["VERIFY", "Both passages exist in the essay", "code"],
  ];
  const sw = 1.3, sg = 0.175;
  steps.forEach(([k, v, kind], i) => {
    const x = 0.7 + i * (sw + sg);
    const isAi = kind === "ai";
    add(s, { t: "text", name: `step${i}`, x, y: 3.55, w: sw, h: 1.5, runs: [
      run(k, { font: F.mono, size: 9.5, bold: true, color: isAi ? "CFEFEA" : C.teal, spacing: 1.2, br: true }),
      run(v, { size: 11, color: isAi ? C.white : C.ink }),
    ], shape: { fill: isAi ? C.teal : C.white, line: isAi ? C.teal : C.teal, lw: 1.25, radius: 0.1 }, margin: 9, valign: "top", anim: { fx: "rise", at: 1700 + i * 520, dur: 500 } });
    L(s, `st-arrow${i}`, x + sw / 2, 3.15, x + sw / 2, 3.53, { color: C.amber, lw: 1.25, dash: "dash", anim: { fx: "wipeD", at: 1500 + i * 520, dur: 280 } });
  });
  T(s, "legend", 0.7, 5.15, 7.2, 0.3, [run("teal = AI  ·  outlined = code  ·  example report, sample data", { font: F.mono, size: 8.5, color: C.faint, spacing: 0.6 })], { anim: { fx: "fade", at: 4300, dur: 400 } });
  add(s, { t: "text", name: "result", x: 0.7, y: 5.5, w: 7.2, h: 0.7, runs: [run("AMBER  ", { font: F.mono, size: 10.5, bold: true, color: C.amberText, spacing: 1.2 }), run("Weak link: the evidence is only loosely connected to the claim.", { size: 12.5, color: C.ink })], shape: { fill: C.amberWash, radius: 0.1 }, margin: 14, valign: "middle", anim: { fx: "rise", at: 4400, dur: 500 } });
  s.els.find((e) => e.name === "result").pulseAt = 5100;

  // proof cards
  const px = 8.3, pw = 4.33;
  const proofs = [
    ["2", "independent examiner runs", "Where they disagree, the report shows it instead of averaging it away."],
    ["1 of 11", "quotes invented", "Caught and removed in one test run. A quote must exist in the essay."],
    ["Our own", "trained classifier", "Scores generic sentences. 550 synthetic sentences, and we say so."],
  ];
  proofs.forEach(([big, label, d], i) => {
    const y = 1.95 + i * 1.42;
    add(s, { t: "text", name: `proof${i}`, x: px, y, w: pw, h: 1.28, runs: [
      run(big + "  ", { font: F.display, size: 24, color: C.teal }), run(label, { font: F.display, size: 13, color: C.ink, br: true }),
      run(d, { size: 10.5, color: C.muted }),
    ], shape: { fill: C.white, line: C.hair, lw: 1, radius: 0.1, shadow: true }, margin: 13, valign: "middle", anim: { fx: "rise", at: 900 + i * 700, dur: 550 } });
  });
  add(s, { t: "text", name: "never", x: 8.3, y: 6.28, w: pw, h: 0.55, runs: [run("The AI never sets the band, picks what to fix, or invents a figure.", { font: F.display, size: 11, color: C.white })], shape: { fill: C.ink, radius: 0.12 }, margin: 12, valign: "middle", anim: { fx: "rise", at: 5600, dur: 500 } });
  T(s, "remove", 0.7, 6.4, 7.2, 0.45, [run("Remove the AI and the product is gone: no handwriting reading, no measuring of meaning.", { size: 10.5, color: C.muted })], { anim: { fx: "fade", at: 5300, dur: 500 } });
}

/* =====================================================================================================
   SLIDE 5: impact, what was built, honest limits
   ===================================================================================================== */
{
  const s = S();
  s.notes = "Impact. This serves SDG 4, quality education, and SDG 10, reduced inequalities, because it works from a phone photo with no academy and no fee. SDG 16 for a fairer path into a merit-based civil service. Every run logs its Gemini calls and tokens, so the cost per essay is measured, not guessed. What we built during AICON'26: the whole pipeline, the interface, and 263 unit tests plus 93 browser tests, none of which call the AI. Pre-existing and disclosed: the design system from an earlier product. And the honest limits: scores are not calibrated against real FPSC marks, our test data is synthetic, there is no separately trained structure model, and the free tier allows few full runs a day. Next step: calibrate against teacher-marked essays. Measure first, judge second, verify everything.";
  chrome(s, 5, title("Built to help. ", "Honest about its limits."), "IMPACT  ·  WHAT WE BUILT  ·  WHAT IT CANNOT DO YET");
  const cols = [
    { x: 0.7, head: "IMPACT", tone: C.teal, items: [
      ["SDG 4", "Quality education: feedback on the exact skill examiners say is missing."],
      ["SDG 10", "Reduced inequalities: a phone photo, no academy, no fee."],
      ["SDG 16", "A fairer start for a merit-based civil service."],
      ["Cost", "Gemini calls and tokens are logged per run: cost per essay is measured."],
    ] },
    { x: 4.85, head: "BUILT AT AICON'26", tone: C.ink, items: [
      ["Pipeline", "Six AI steps, each with a code check, behind one API."],
      ["Interface", "Every highlight explains itself. Works on a phone."],
      ["Tests", "263 unit and 93 browser tests. None call the AI."],
      ["Disclosed", "Design system from an earlier product (Verchek). Data is synthetic, and labelled."],
    ] },
    { x: 9.0, head: "NOT YET", tone: C.amber, items: [
      ["Scores", "Not calibrated against real FPSC marks."],
      ["Data", "Our evaluations use synthetic sentences."],
      ["Structure", "Gemini labels plus rules; no separate trained model."],
      ["Quota", "The free tier allows few full runs a day."],
    ] },
  ];
  cols.forEach((c, ci) => {
    const base = 600 + ci * 450;
    mono(s, `col${ci}-h`, c.x, 1.95, 3.6, c.head, c.tone, { anim: { fx: "fade", at: base, dur: 400 } });
    L(s, `col${ci}-rule`, c.x, 2.3, c.x + 3.65, 2.3, { color: c.tone, lw: 1.5, anim: { fx: "wipeL", at: base + 100, dur: 500 } });
    c.items.forEach(([k, v], i) => {
      add(s, { t: "text", name: `col${ci}-i${i}`, x: c.x, y: 2.5 + i * 0.86, w: 3.65, h: 0.8, runs: [run(k + "   ", { font: F.display, size: 13, color: c.tone === C.amber ? C.amberText : C.teal }), run(v, { size: 12.5, color: C.ink })], valign: "top", anim: { fx: "rise", at: base + 400 + i * 380, dur: 500 } });
    });
  });
  add(s, { t: "text", name: "closing", x: 0.7, y: 6.05, w: 8.4, h: 0.62, runs: [run("Measure first. Judge second. Verify everything.", { font: F.display, size: 20, color: C.white })], shape: { fill: C.teal, radius: 0.31 }, margin: 20, valign: "middle", anim: { fx: "wipeL", at: 4600, dur: 800 } });
  T(s, "repo", 9.3, 6.2, 3.35, 0.4, [run("github.com/Abdullah-creator-alt/galti-pakar", { font: F.mono, size: 9, color: C.muted })], { align: "right", anim: { fx: "fade", at: 5400, dur: 500 } });
  s.els.find((e) => e.name === "closing").pulseAt = 5600;
}

/* =====================================================================================================
   renderer 1: pptxgenjs
   ===================================================================================================== */
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.title = "Galti Pakar: AICON'26 Build With AI";
pptx.author = "Galti Pakar";

const dash = { dash: "dash" };
const runsToPptx = (runs) => runs.map((r) => ({
  text: r.text,
  options: {
    fontFace: r.font ?? F.body, fontSize: r.size ?? 12, color: r.color ?? C.ink, bold: !!r.bold,
    ...(r.hl ? { highlight: r.hl } : {}), ...(r.ul ? { underline: r.ul } : {}), ...(r.spacing ? { charSpacing: r.spacing } : {}),
    ...(r.br ? { breakLine: true } : {}),
  },
}));

for (const sp of slides) {
  const slide = pptx.addSlide();
  slide.background = { color: sp.bg };
  for (const e of sp.els) {
    if (e.t === "text") {
      const o = { x: e.x, y: e.y, w: e.w, h: e.h, align: e.align, valign: e.valign, margin: e.margin, objectName: e.name, fit: "none", wrap: true };
      if (e.shape) {
        o.shape = pptx.ShapeType.roundRect;
        o.rectRadius = e.shape.radius ?? 0.1;
        o.fill = { color: e.shape.fill };
        if (e.shape.line) o.line = { color: e.shape.line, width: e.shape.lw ?? 1, ...(e.shape.dash ? { dashType: e.shape.dash } : {}) };
        if (e.shape.shadow) o.shadow = { type: "outer", color: "0C1F1C", opacity: 0.12, blur: 12, offset: 3, angle: 90 };
      }
      slide.addText(runsToPptx(e.runs), o);
    } else if (e.t === "line") {
      const x = Math.min(e.x1, e.x2), y = Math.min(e.y1, e.y2);
      slide.addShape(pptx.ShapeType.line, {
        x, y, w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1), objectName: e.name,
        line: { color: e.color, width: e.lw, ...(e.dash ? { dashType: e.dash } : {}), ...(e.arrow ? { endArrowType: "triangle" } : {}) },
      });
    } else if (e.t === "img") {
      slide.addImage({ path: IMG(e.file), x: e.x, y: e.y, w: e.w, h: e.h, objectName: e.name });
    }
  }
  if (sp.notes) slide.addNotes(sp.notes);
}

/* =====================================================================================================
   PowerPoint animation XML (entrance and emphasis), injected into each slide
   ===================================================================================================== */
function effectXml(e, spid, nid) {
  const dur = e.dur ?? 500;
  const set = () => `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
  const filt = (f) => `<p:animEffect transition="in" filter="${f}"><p:cBhvr><p:cTn id="${nid()}" dur="${dur}"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`;
  const anim = (attr, from, to) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="${nid()}" dur="${dur}" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val>${from}</p:val></p:tav><p:tav tm="100000"><p:val>${to}</p:val></p:tav></p:tavLst></p:anim>`;
  const fl = (v) => `<p:fltVal val="${v}"/>`;
  const sv = (v) => `<p:strVal val="${v}"/>`;
  switch (e.fx) {
    case "fade": return { id: 10, cls: "entr", sub: 0, body: set() + filt("fade") };
    case "wipeL": return { id: 22, cls: "entr", sub: 8, body: set() + filt("wipe(left)") };
    case "wipeD": return { id: 22, cls: "entr", sub: 1, body: set() + filt("wipe(down)") };
    case "rise": return { id: 42, cls: "entr", sub: 0, body: set() + anim("ppt_y", sv("#ppt_y+.06"), sv("#ppt_y")) + filt("fade") };
    case "zoom": return { id: 53, cls: "entr", sub: 16, body: set() + anim("ppt_w", fl(0), sv("#ppt_w")) + anim("ppt_h", fl(0), sv("#ppt_h")) + filt("fade") };
    case "pulse": return { id: 26, cls: "emph", sub: 0, body: `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="${dur}" autoRev="1" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr><p:by x="106000" y="106000"/></p:animScale>` };
    default: throw new Error("unknown effect " + e.fx);
  }
}

function timingXml(effects, idByName) {
  let n = 4;
  const nid = () => ++n;
  const parts = effects.map((e) => {
    const spid = idByName.get(e.name);
    if (!spid) throw new Error(`no shape named ${e.name}`);
    const parId = nid();
    const x = effectXml(e, spid, nid);
    return `<p:par><p:cTn id="${parId}" presetID="${x.id}" presetClass="${x.cls}" presetSubtype="${x.sub}" fill="hold" nodeType="withEffect"><p:stCondLst><p:cond delay="${e.at}"/></p:stCondLst><p:childTnLst>${x.body}</p:childTnLst></p:cTn></p:par>`;
  });
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${parts.join("")}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}

const buf = await pptx.write({ outputType: "nodebuffer" });
const zip = await JSZip.loadAsync(buf);
let animCount = 0;
for (let i = 0; i < slides.length; i++) {
  const file = `ppt/slides/slide${i + 1}.xml`;
  let xml = await zip.file(file).async("string");
  const idByName = new Map([...xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)].map((m) => [m[2], Number(m[1])]));
  const effects = [];
  for (const el of slides[i].els) {
    if (el.anim) effects.push({ name: el.name, ...el.anim });
    if (el.pulseAt) effects.push({ name: el.name, fx: "pulse", at: el.pulseAt, dur: 450 });
  }
  effects.sort((a, b) => a.at - b.at);
  animCount += effects.length;
  const transition = `<p:transition spd="slow"><p:fade/></p:transition>`;
  if (!xml.includes("</p:clrMapOvr>")) throw new Error("slide xml shape changed: no clrMapOvr");
  xml = xml.replace("</p:clrMapOvr>", `</p:clrMapOvr>${transition}${timingXml(effects, idByName)}`);
  zip.file(file, xml);
}
mkdirSync("deck", { recursive: true });
writeFileSync(OUT, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`wrote ${OUT}: ${slides.length} slides, ${animCount} animations`);

/* =====================================================================================================
   renderer 2: HTML preview (layout check only; PowerPoint draws text a little differently)
   ===================================================================================================== */
mkdirSync("deck/preview", { recursive: true });
const px = (v) => `${(v * 96).toFixed(1)}px`;
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ulStyle = { sng: "solid", dash: "dashed", wavy: "wavy" };
slides.forEach((sp, i) => {
  const parts = sp.els.map((e) => {
    if (e.t === "line") {
      const x = Math.min(e.x1, e.x2), y = Math.min(e.y1, e.y2), w = Math.abs(e.x2 - e.x1), h = Math.abs(e.y2 - e.y1);
      const vertical = w < 0.001;
      return `<div style="position:absolute;left:${px(x)};top:${px(y)};width:${vertical ? 0 : px(w)};height:${vertical ? px(h) : 0};${vertical ? "border-left" : "border-top"}:${(e.lw * 96) / 72}px ${e.dash ? "dashed" : "solid"} #${e.color}"></div>`;
    }
    if (e.t === "img") return `<img src="../img/${e.file}" style="position:absolute;left:${px(e.x)};top:${px(e.y)};width:${px(e.w)};height:${px(e.h)}">`;
    const inner = e.runs.map((r) => {
      const st = `font-family:'${r.font ?? F.body}';font-size:${((r.size ?? 12) * 96) / 72}px;color:#${r.color ?? C.ink};${r.bold ? "font-weight:700;" : ""}${r.spacing ? `letter-spacing:${r.spacing}px;` : ""}${r.hl ? `background:#${r.hl};` : ""}${r.ul ? `text-decoration:underline ${ulStyle[r.ul.style] ?? "solid"} #${r.ul.color};text-underline-offset:3px;` : ""}`;
      return `<span style="${st}">${esc(r.text)}</span>${r.br ? "<br>" : ""}`;
    }).join("");
    const sh = e.shape;
    const box = sh ? `background:#${sh.fill};${sh.line ? `border:${(sh.lw ?? 1) * 96 / 72}px ${sh.dash ? "dashed" : "solid"} #${sh.line};` : ""}border-radius:${px(sh.radius ?? 0.1)};${sh.shadow ? "box-shadow:0 3px 12px rgba(12,31,28,.12);" : ""}` : "";
    const just = { top: "flex-start", middle: "center", bottom: "flex-end" }[e.valign];
    return `<div style="position:absolute;left:${px(e.x)};top:${px(e.y)};width:${px(e.w)};height:${px(e.h)};box-sizing:border-box;padding:${(e.margin * 96) / 72}px;display:flex;flex-direction:column;justify-content:${just};text-align:${e.align};line-height:1.2;${box}"><div>${inner}</div></div>`;
  }).join("\n");
  writeFileSync(`deck/preview/slide${i + 1}.html`, `<!doctype html><meta charset="utf-8"><body style="margin:0"><div style="position:relative;width:${px(W)};height:${px(H)};background:#${sp.bg};overflow:hidden">${parts}</div>`);
});
console.log("preview in deck/preview/");

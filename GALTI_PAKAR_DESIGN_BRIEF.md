# Galti Pakar: UI Design Brief

> **Paste this whole file into a new Claude Code session in an empty project.** It is self-contained: everything needed to design and build the UI is here.

## 0. Your task

Build the **UI only** for **Galti Pakar**, a CSS (Pakistan civil service exam) essay analyser. A candidate uploads a photo of a handwritten practice essay; the tool reads it, analyses it, and shows a detailed feedback report.

- **Do not build the analysis backend.** Use typed mock data (§10) behind one data-access function, so real data can replace it later without touching components.
- **Follow the design system in this brief exactly.** Tokens, type, spacing, components and motion are all specified below.
- **Recommended stack** (so the code in this brief pastes in unchanged): Next.js 15 (App Router), React 19, TypeScript strict, Tailwind CSS v4. Any other React setup works if you port the CSS variables and class recipes faithfully.
- **Screens to build:** (1) Upload, (2) Processing, (3) Report (the main one), (4) History (optional, lower priority).
- **Tone:** credible, exam-grade, trustworthy. Calm and analytical, closer to a grading or analytics dashboard than a social app. No gamification, no confetti, no emoji, no streaks, no playful illustration.

Mock data is **mock**. Wherever the UI shows a score, verdict or examiner result that is not real yet, label it as an example (§9.4). Never present invented analysis as a real result.

---

## 1. Design principles (carry these into every decision)

They matter more than any single pixel value.

1. **Refuse the average.** No flat generic dashboard, no four identical cards in a row, no one border radius everywhere, no uniform fade-in on everything.
2. **Spend boldness in one place.** On the report, the *highlighted essay* and the *verdict* carry the weight; everything else stays quiet.
3. **Accent is for action, focus and live state only.** Teal marks buttons, focus rings and "in progress". It is not decoration, and it is **not** the "good" colour (see §2.3).
4. **Computed, never decorative.** Every badge, count, band and agreement indicator is derived from the data. Nothing is a permanent green tick.
5. **Absence is stated plainly.** If something was not assessed, the UI says what and why. Never a blank, never a placeholder that looks like a result.
6. **Colour is never the only signal.** Highlights and tags also differ by underline style, icon or label (§9.3). This matters for colour-blind users and for print.
7. **Honest about AI.** Show bands and examiner agreement, not false precision. Always show a limitation note that this is AI-assisted practice feedback, not an official examiner's mark. (Wording to be approved by the product owner; use the placeholder in §9.4.)
8. **Concrete copy.** "Three examiners scored this; two agreed within one band" beats "Powerful insights".

---

## 2. Colour tokens

### 2.1 How theming works

All colour is a CSS custom property. Light is the default. Dark mode is a `data-theme="dark"` attribute on `<html>` that redefines the same tokens (§6). Components never use raw hex; they use token-backed Tailwind utilities (`bg-gp-card`, `text-gp-text-muted`, `border-gp-border` …).

The rule that makes both themes work: **screens are dark, paper follows the theme.** Anything that represents a *device or media* (here: the uploaded essay photo frame) uses the fixed `--gp-device-*` tokens and stays dark in both themes. Pages, cards and the report follow the theme.

### 2.2 Core palette (paste-ready CSS in Appendix A)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--gp-bg` | `#f2f6f6` | `#070c12` | Page ground (cool paper, never pure white or black) |
| `--gp-bg-field` | radial white → `#f2f6f6` → `#e9efef` | radial `#102131` → `#0b1522` → `#070c12` | Page-header and hero field |
| `--gp-surface` / `--gp-card` | `#ffffff` | `#0b1622` / `#08121d` | Panels and cards |
| `--gp-surface-raised` | `#ffffff` | `#0c1421` | Hover state of a card |
| `--gp-border` | `rgba(13,148,136,.18)` | `rgba(6,182,212,.20)` | Hairlines, a teal tint rather than grey |
| `--gp-border-strong` | `rgba(13,148,136,.34)` | `rgba(6,182,212,.38)` | Emphasis and hover borders |
| `--gp-text` | `#0b1a1e` | `#f1f5f9` | Headlines and essay text |
| `--gp-text-secondary` | `#3f5157` | `#cbd5e1` | Body copy |
| `--gp-text-muted` | `#4b5c62` | `#94a3b8` | Captions, labels, metadata (lightest allowed for text) |
| `--gp-accent` | `#2dd4bf` | `#2dd4bf` | **Fills and graphics only.** As text on light it is 1.71:1 and fails |
| `--gp-accent-text` | `#0f766e` | `#2dd4bf` | The only teal approved for **text** (5.03:1 on light) |
| `--gp-accent-strong` | `#0f766e` | `#2dd4bf` | Primary button fill |
| `--gp-accent-hover` | `#115e59` | `#20cfbd` | Button hover |
| `--gp-on-accent` | `#ffffff` | `#06181d` | Text on an accent fill |
| `--gp-accent-wash` | `rgba(45,212,191,.10)` | `rgba(45,212,191,.10)` | Soft highlight background |
| `--gp-device-bg` | `#070c12` | `#070c12` | Photo frame ground (always dark) |
| `--gp-device-surface` / `-border` / `-text` / `-muted` | `#08121d` / `rgba(6,182,212,.2)` / `#f1f5f9` / `#94a3b8` | same | Always-dark media frames |

Shadows (`--gp-elev-1/2/3`) pair a shadow with a faint top light edge on dark. Glows (`--gp-glow-cta`, `--gp-glow-hover`) are low-opacity and wide, never hard neon.

### 2.3 Status and highlight colours

Galti Pakar uses a three-colour highlight system plus a neutral state for anything not assessed. Each colour is a *wash / text / solid* trio. All text-on-wash pairs below were measured with the WCAG formula.

| Meaning | Highlight in essay | Token trio (light → dark) |
|---|---|---|
| **Strong** | green | `--gp-good` `#15803d`, `--gp-good-wash` `rgba(22,163,74,.16)` → `rgba(74,222,128,.16)`, `--gp-good-text` `#166534` → `#86efac` |
| **Weak or generic** | amber | `--gp-flag` `#f6ae31`, `--gp-flag-wash` `#fef9f0` → `rgba(246,174,49,.12)`, `--gp-flag-text` `#6c4604` → `#fbd593` |
| **Off-topic, unsupported or filler** | red | `--gp-alert` `#b91c1c`, `--gp-alert-wash` `rgba(220,38,38,.12)` → `rgba(248,113,113,.16)`, `--gp-alert-text` `#991b1b` → `#fca5a5` |
| **Not assessed** | none | `--gp-text-muted` with a dash |

Three state icons accompany these in summary tiles and step lists: a **tick** (`--gp-accent-text`) for met or agreed, a **clock** (`--gp-flag-text`) for worth a second look, and a **dash** (`--gp-text-muted`) for not assessed.

Measured contrast:

| Pair | Ratio |
|---|---|
| Essay text `#0b1a1e` on the green / amber / red wash (light) | 14.9 / 14.7 / 14.8 : 1 |
| Essay text `#f1f5f9` on the green / amber / red wash (dark) | 12.0 / 11.9 / 13.4 : 1 |
| `--gp-good-text` on white / on its wash | 7.1 / 6.0 : 1 |
| `--gp-alert-text` on white / on its wash | 8.3 / 6.9 : 1 |
| `--gp-flag-text` on white / on its wash | 8.4 / 6.9 : 1 |
| `--gp-good-text` `#86efac` on dark surface | 13.0 : 1 |
| `--gp-alert-text` `#fca5a5` on dark surface | 9.6 : 1 |
| White on `--gp-good` / `--gp-alert` solid | 5.0 / 6.5 : 1 |

**Teal is for actions; green is for "strong".** The two hues are close. Never use teal to mean good, and never use green for a button. Rules:

- Text on a solid fill (`--gp-good`, `--gp-alert`, `--gp-flag`): in **light** mode it is white on good and alert, and ink `#0a0a0a` on amber. In **dark** mode the good and alert solids are the lighter greens and reds, so text on them is dark ink (`#06181d`), never white.
- Never use a raw Tailwind `green-*`, `red-*` or `amber-*` class in a component. Use the tokens.

---

## 3. Typography

Two faces, loaded with `next/font/google`:

| Role | Face | Use |
|---|---|---|
| **Display and body** | **Plus Jakarta Sans**, weights 400–800 (variable `--font-jakarta`) | All headings and all running text |
| **Data and labels** | **IBM Plex Mono**, 400 and 500 (variable `--font-data`), class `.font-data` | Eyebrows, score labels, tag names, counts, axis labels, timestamps |

Headings use `letter-spacing: -0.02em`. Labels are **uppercase** with wide tracking (`0.12–0.16em`). Numbers that line up use `font-variant-numeric: tabular-nums`.

### Type scale

| Role | Size | Weight | Notes |
|---|---|---|---|
| Hero headline (marketing only) | 46 → 62 → 76 px | 700 | Tight leading (0.9) |
| Page title (`h1` on a page header) | `clamp(34px, 4.4vw, 56px)` | 800 | leading 1.08 |
| Section heading (`h2`) | `clamp(28px, 3.2vw, 42px)` | 800 | leading 1.1 |
| Card title | 20–21 px | 700 | leading 1.2–1.3 |
| Body large | 17 px | 400 | leading relaxed |
| Body | 15–16 px | 400 | line-height 1.6 |
| Small | 13–14 px | 400–600 | |
| Eyebrow | 11 px | 700 | uppercase, `0.16em` tracking, `--gp-accent-text` |
| Data label | 9–11 px | 600–700 | `.font-data`, uppercase |
| Big number (stat) | 22–32 px | 700 | `.font-data` or Jakarta, tabular |

**Report screen sizes** (on screen, not print): tile label 10.5 px, tile value 22 px, section rule label 11 px, body 15 px, essay text 17 px at line-height 1.8 for comfortable reading and marking.

---

## 4. Spacing, layout, radius, elevation, touch

- **Spacing scale** (8-point): `4, 8, 12, 16, 24, 32, 48, 64, 96`. Use nothing else.
- **Container:** `max-w-[1440px]`, rising to `1600px` at `2xl`; horizontal padding steps `24 → 40 → 64 px`. (For the **report** use a narrower reading container of `max-w-[1120px]`; for **upload** and **processing** use `max-w-[620px]`.)
- **Section rhythm:** marketing sections `py-20 lg:py-28`. In the app, space report sections `mt-12` (48 px) apart, with an 11 px uppercase *section rule* label between them (§7.8).
- **Page header:** sits on `--gp-bg-field`, `border-b border-gp-border`, `pt-16 pb-14` (desktop `pt-20 pb-16`). The first content block after it uses `tightTop` (`pt-14`), otherwise the two paddings stack into a dead band.
- **Radius varies by role:** small controls and inputs 8–11 px; report cards 12–14 px; marketing cards 18 px; large panels 20 px; pills, badges and primary buttons fully round (`rounded-full`).
- **Card padding:** `p-7` (28 px) for roomy cards; `p-4` to `p-5` for dense in-app cards.
- **Elevation:** cards use `box-shadow: var(--gp-elev-2)`. Hover lifts a card 4 px and brightens its border.
- **Touch targets:** at least **44 × 44 px** for everything tappable. Candidates will photograph essays with a phone.
- **Phone first:** design at about 390 px wide; widen at `sm` (640), `lg` (1024), `2xl` (1536).

### Page chrome

- **Marketing and app header** (`Header`): fixed, about 73 px tall, **transparent at the top of the page** (hero field shows through), and past ~32 px of scroll or with the mobile drawer open becomes a flat `bg-gp-bg/85` bar with `backdrop-blur-xl` and a hairline bottom border. CTA is a solid near-black pill with white text, deliberately *not* teal, so it reads as a button on any field.
- **Focused-flow shell** (`FlowShell`, used for Upload and Processing): a slim sticky header with the wordmark left, a step rail centre (**numbered circles with labels**, collapsing to "Step 2 of 3" on phones), and a quiet exit button right. No full navigation, because the user is mid-task.
- **Wordmark:** uppercase Plus Jakarta Sans ExtraBold, tight tracking, the **first letter in `--gp-accent-text`**: `<span class="text-gp-accent-text">G</span>ALTI PAKAR`.

---

## 5. Motion

Motion is choreographed, not uniform. Every animation has a reduced-motion fallback that lands in the end state.

| Pattern | Class | Behaviour |
|---|---|---|
| Load entrances | `.gp-enter-rise`, `.gp-enter-fade`, `.gp-enter-scale` | Stagger 60–90 ms; rise (24 px, 0.9 s) for headlines, scale (0.94 → 1, 1.1 s) for visuals, fade for labels. Whole sequence under about 1.2 s |
| Scroll reveals | `.gp-reveal`, `-left`, `-scale` + a `Reveal` wrapper | `IntersectionObserver`, 15% visible, **once**, varied transform per section |
| Buttons | `.gp-btn-primary`, `.gp-btn-ghost` | Lift 2 px and glow on hover (200 ms), press to `scale(.98)` |
| Cards | `.gp-card` | Lift 4 px, border brightens, elevation steps up (250 ms) |
| Line draw | `.gp-draw` | SVG stroke draws itself once on load (2.4 s). Use for the drift chart line |
| Easing | `--gp-ease-out: cubic-bezier(.16,1,.3,1)`, `--gp-ease-inout: cubic-bezier(.4,0,.2,1)` | Never `linear`, never an instant snap |

Reduced motion: entrances and reveals show immediately, hover transforms stay but transitions shorten, and the drift line renders already drawn.

**Focus:** a 2 px accent ring, offset 3 px, always visible: `:focus-visible { outline: 2px solid var(--gp-accent); outline-offset: 3px; }`. Never `outline: none` without a replacement.

---

## 6. Dark mode

Theming works like this:

- Tokens are redefined under `[data-theme="dark"]` (full set in Appendix A). `color-scheme` is set so native controls follow.
- A small **theme toggle** (36 px circular icon button, sun or moon, `border-gp-border`, `hover:border-gp-border-strong`) sets `document.documentElement.setAttribute("data-theme", next)` and stores the choice in `localStorage` (wrapped in `try/catch`, because storage can be blocked).
- **Do not flash the wrong theme.** Add an inline script in `<head>` that reads `localStorage` (falling back to `prefers-color-scheme`) and sets `data-theme` before first paint. Render a stable icon until mounted so server and client markup match.
- **Device frames stay dark in both themes** (the essay photo frame, the upload thumbnails). That keeps a photograph reading as a photograph.
- **Highlights in dark mode** use the dark wash and dark text values from §2.3. Do not reuse the light washes, which would glare.
- Chart colours and fills come from tokens (`stroke: var(--gp-accent)`, `fill: var(--gp-text-muted)`), never hard-coded, so the chart follows the theme with no extra code.
- Add `suppressHydrationWarning` to `<html>` and `<body>`; browser extensions add attributes to them.

---

## 7. Reusable components (build these first, exactly as specified)

They are given here as class recipes.

### 7.1 Eyebrow

A small uppercase label above a heading.

```tsx
<p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gp-accent-text">{children}</p>
```

### 7.2 PageHeader, Section, SectionHeading

```tsx
// PageHeader: eyebrow + h1 + lead on the bg-field, hairline below
<section className="relative border-b border-gp-border" style={{ background: "var(--gp-bg-field)" }}>
  <Container className="pb-14 pt-16 lg:pb-16 lg:pt-20">
    <div className="max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-4 text-[clamp(34px,4.4vw,56px)] font-extrabold leading-[1.08] text-gp-text">{title}</h1>
      {lead && <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-gp-text-secondary">{lead}</p>}
    </div>
  </Container>
</section>

// Section: vertical rhythm; `tinted` adds a surface band with hairlines
<section className={`${tightTop ? "pb-20 pt-14 lg:pb-28 lg:pt-16" : "py-20 lg:py-28"} ${tinted ? "bg-gp-surface border-y border-gp-border" : ""}`}>
  <Container>{children}</Container>
</section>

// SectionHeading: eyebrow, h2 (clamp 28→42), lead
<h2 className="mt-3 text-[clamp(28px,3.2vw,42px)] font-extrabold leading-[1.1] text-gp-text">{title}</h2>
```

### 7.3 Button

Pill-shaped, `rounded-full`. Primary is a solid `--gp-accent-strong` fill with the CTA glow; secondary ("ghost") is outlined.

```tsx
const base = "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold transition-all duration-200";
primary:   "gp-btn-primary bg-gp-accent-strong text-gp-on-accent"   // style={{ boxShadow: "var(--gp-glow-cta)" }}
secondary: "gp-btn-ghost border border-gp-border-strong bg-gp-surface text-gp-text"
// Large primary for a form's submit (min 56 px tall, thumb-friendly):
"gp-btn-primary h-14 w-full rounded-full bg-gp-accent-strong text-[15px] font-bold tracking-tight text-gp-on-accent"
```

Both include a 15 px right-arrow icon. Disabled: `opacity-60`, no hover lift.

### 7.4 Card

```tsx
<div className="rounded-[18px] border border-gp-border bg-gp-card p-7 gp-card" style={{ boxShadow: "var(--gp-elev-2)" }}>
```

Pass `hover={false}` (drop the `gp-card` class) for **static report cards**, which must not lift when moused over.

### 7.5 Joined stat-tile row (the report's summary strip)

The report's most distinctive pattern: tiles share hairlines, drawn by a one-pixel grid gap over a border-coloured background.

```tsx
<div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-gp-border bg-gp-border sm:grid-cols-4">
  <div className="bg-gp-surface px-4 py-4 text-center">
    <StateIcon />                                   {/* tick | clock | dash, 11–14 px */}
    <p className="text-[22px] font-bold leading-none text-gp-accent-text">8 of 8</p>
    <p className="mt-1.5 font-data text-[10.5px] font-semibold uppercase tracking-[0.1em] text-gp-text-muted">Label</p>
  </div>
  ...
</div>
```

State icons are 24-box SVG circles: **tick** (`text-gp-accent-text`), **clock** (`text-gp-flag-text`), **dash** (`text-gp-text-muted`). Value colour matches the state. *Caution:* the joined trick fills empty grid cells with the border colour, so only use it when tiles fill every cell (4-up here). For the 7-tile scorecard use separate tiles (§9.2).

### 7.6 Detail row (label and value with an icon tile)

Used for key facts in a report header (topic, date, word count):

```tsx
<div className="flex items-start gap-2">
  <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-gp-accent-wash text-gp-accent-text">{icon}</span>
  <div>
    <dt className="font-data text-[10px] font-bold uppercase tracking-[0.14em] text-gp-accent-text">Label</dt>
    <dd className="mt-0.5 text-[14px] font-semibold leading-tight text-gp-text">Value</dd>
  </div>
</div>
```

### 7.7 Reading tile

A bordered tile for a single key value: `rounded-[8px] border border-gp-border px-3 py-3`, label `font-data 10px uppercase tracking-[0.14em] text-gp-accent-text`, value `font-data text-[18px] font-bold text-gp-text`.

### 7.8 SectionRule

Introduces each report section: a small uppercase accent label followed by a hairline that fills the row.

```tsx
<div className="mb-4 mt-12 flex items-center gap-3">
  <span className="font-data text-[11px] font-bold uppercase tracking-[0.15em] text-gp-accent-text">{title}</span>
  <span className="h-px flex-1 bg-gp-border" />
</div>
```

### 7.9 Tone card (left-rail section card)

Used for grouped findings ("Supports your position", "Areas of concern"). A 4 px coloured left border carries the tone:

```tsx
<div className="rounded-xl border border-gp-border border-l-4 bg-gp-surface p-4 {border-l-color}">
  <p className="mb-2 text-sm font-semibold text-gp-text">{title}</p>
  <div className="text-sm text-gp-text-secondary">{children}</div>
</div>
// rail colour: good → border-l-gp-good | amber → border-l-gp-flag | alert → border-l-gp-alert | neutral → border-l-gp-border-strong
```

### 7.10 Numbered step cards ("What to do" pattern)

Three side-by-side cards, each a bordered box with a mono number, a bold title, and a short body:

```tsx
<ol className="grid gap-4 sm:grid-cols-3">
  <li className="rounded-[10px] border border-gp-border px-4 py-3.5">
    <p className="font-data text-[10px] font-bold tracking-[0.14em] text-gp-accent-text">01</p>
    <p className="mt-1.5 text-[15px] font-bold leading-tight text-gp-text">Title</p>
    <p className="mt-1.5 text-[13px] leading-snug text-gp-text-secondary">Body</p>
  </li>
</ol>
```

### 7.11 Limitation note

A contractual-style disclaimer box. The wording is fixed and never paraphrased. Use it on the report and anywhere AI output is shown:

```tsx
<div className="rounded-[14px] border border-gp-border bg-gp-surface p-6">
  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gp-text-muted">Important limitation</p>
  <p className="mt-3 text-sm leading-relaxed text-gp-text-secondary">{text}</p>
</div>
```

A second variant, used at the foot of documents: `rounded-[6px] border-l-2 border-gp-accent bg-gp-accent-wash px-4 py-3` with a `font-data` 8–9 px accent label ("Limitations") and 12–13 px body in `--gp-text-secondary`.

### 7.12 Form field

```tsx
<label htmlFor={id} className="text-[13.5px] font-semibold text-gp-text">{label}</label>
<input id={id} className="w-full rounded-[11px] border border-gp-border bg-gp-surface px-4 py-3 text-base text-gp-text placeholder:text-gp-text-muted transition-colors focus:border-gp-accent focus:outline-none focus:ring-2 focus:ring-gp-accent/25 sm:text-[15px]" />
<p className="text-[12.5px] leading-snug text-gp-text-muted">{hint}</p>
```

Always `text-base` (16 px) on phones so iOS does not zoom on focus.

### 7.13 Media (photo) frame

A 4:3 frame on the **always-dark** device ground; the photo is shown whole (`object-contain`), never cropped, because cropping could hide the very mark someone is looking for:

```tsx
<div className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-gp-device-border bg-gp-device-bg">
  <img className="absolute inset-0 h-full w-full object-contain" />
</div>
```

### 7.14 Loading, empty and error states

Use plain-language screens, never a blank page: a centred small-caps line for loading (`font-data text-[11px] uppercase tracking-[0.2em] text-gp-text-muted`, with `aria-live="polite"`), and for empty or missing data a centred block with an `h1` ("This report isn't on this device"), two sentences explaining why, and one button back. Errors use `role="alert"`, say what happened and how to fix it, and never apologise or stay vague. Use the same for "no essays yet" and "couldn't read this photo".

### 7.15 Reveal, ThemeToggle, Container

`Reveal`: an `IntersectionObserver` wrapper (`threshold 0.15`, `rootMargin "0px 0px -40px 0px"`, disconnect after first show, show immediately under reduced motion). `ThemeToggle`: see §6. `Container`: `mx-auto w-full max-w-[1440px] px-6 md:px-10 lg:px-16 2xl:max-w-[1600px]`.

**Do not add a chart library, table, tab or modal.** Charts are hand-drawn SVG, built in the same visual language (§9) using the tokens above.

---

## 8. Screens

### 8.1 Upload (`/new`): low-anxiety entry point

Shell: `FlowShell` with a 3-step rail (**Upload → Analyse → Report**). Single column, `max-w-[620px]`, `px-5 py-12 sm:py-16`.

1. **Header** (`FlowHeader`): eyebrow "New essay", `h1` ≈ 28–38 px ExtraBold ("Upload your handwritten essay"), one reassuring sentence. Example: "No account needed to try it. A photo from your phone is fine."
2. **Topic field:** a text input ("Essay topic") with a hint. Also offer a `select` or suggestion chips of past CSS topics. Required.
3. **Photo drop zone:** a large dashed-border card, `rounded-[14px] border border-dashed border-gp-border-strong bg-gp-accent-wash px-5 py-5`, with an icon tile, "Add photos of your essay", a hint ("One photo per page. We read them in order."), and two actions: **Take photo** and **Choose from gallery**. Drag-and-drop on desktop.
4. **Added pages:** a grid of 4:3 thumbnails in the media frame (§7.13) with page numbers `font-data` top-left, and Remove and Reorder controls. Show a computed note under it: "3 pages added".
5. **Submit:** the large primary button, "Analyse my essay". Disabled until a topic and at least one photo exist; when disabled, say why in plain text beneath it.
6. A one-line privacy note and the limitation note (§7.11).

States: empty, photos added, upload error (`role="alert"`, plain wording), file too large or wrong type (say the limit).

### 8.2 Processing (`/analysing`): real multi-step progress

Same `FlowShell`, centred, `max-w-[560px]`. **Never a plain spinner.** The analysis takes about 10–20 seconds, so show *which real step is running*.

- A vertical **stepper** inside a paper card. Each row has a state icon, a title and a one-line description:
  1. **Reading handwriting** — "Turning your photo into text"
  2. **Checking structure** — "Finding your position, claims and evidence"
  3. **Scoring against the rubric** — "Seven dimensions, scored by several examiners"
  4. **Preparing your report** (optional fourth)
- Row states: **pending** (muted dash, `--gp-text-muted`), **active** (accent ring pulsing slowly, title in `--gp-text`, description visible), **done** (tick in `--gp-accent-text`, description collapses to a muted completion line). Use the same icon family as the stat tiles.
- Show an honest time hint ("This usually takes about 15 seconds"). **Do not show a percentage bar that is not tied to real progress.** Steps complete when the work completes.
- `aria-live="polite"` on the stepper so screen readers hear each step change.
- If a step fails: the failed row turns to the amber flag style, and a plain message with a **Try again** button appears. Never lose the uploaded photos.
- Reduced motion: no pulsing; state is conveyed by icon alone.

### 8.3 Report (`/report/[id]`): the main screen

Structure: **masthead → key facts → a summary strip of computed tiles → a series of titled sections → limitation note.** Reading container `max-w-[1120px]`, page `px-4 sm:px-8`, sections 48 px apart, each introduced by a *SectionRule* (§7.8).

**A. Header** (a `PageHeader`-style block, left aligned):
- Eyebrow "Essay report".
- `h1`: the essay topic.
- A **verdict band** (§9.1) and the date.
- Key facts as *Detail rows* (§7.6): word count, number of pages, number of paragraphs, date analysed.
- Right side on desktop: Download PDF and Share (secondary buttons). They may be non-functional in the first build; if so, label them "Coming soon" rather than leaving a dead button.

**B. Summary strip** (joined stat tiles, §7.5), four tiles: **Overall score** · **Word count** · **Paragraphs** · **Examiners agree** (value computed, e.g. "3 of 3"; state icon tick, clock or dash by the rule in §9.5).

**C. Scorecard** (§9.2): seven separate score tiles, one per rubric dimension.

**D. Your essay** (§9.3): the full text, with inline highlights and a reason popover. A legend (Strong, Weak or generic, Off-topic or unsupported) doubles as a filter. On `lg`, the reason shows in a sticky side panel; on phones, in a bottom sheet.

**E. Topic drift** (§9.6): the line chart.

**F. Structure** (§9.7): the tagged outline of paragraphs.

**G. Top 3 fixes** (§9.8): ranked, using the numbered step cards pattern (§7.10).

**H. Before and after** (§9.9): one weak paragraph beside its rewrite.

**I. Examiner panel** (§9.5): how many AI examiners scored it, and whether they agreed.

**J. Limitation note** (§7.11) at the foot, plus a quieter repeat of the "AI-assisted, not an official mark" line near the verdict.

Section order matters: the user's questions in order are *"How did I do?" → "Where exactly?" → "Why?" → "What do I fix?"*, which is the order above.

### 8.4 History (`/history`): lower priority

A list, grouped by date. Each essay is a card (`rounded-[16px]`, `p-5`, not hoverable-lift heavy): topic as the title, date, a verdict pill, overall score in `.font-data`, and a chevron or "Open report" link. Newest first. Empty state: plain "No essays yet", one sentence, and a button to upload. If a score trend is shown, keep it to a simple sparkline built with the same SVG approach as the drift chart.

---

## 9. Report components

### 9.1 Verdict band

A single calm pill beside the topic, not a banner or badge-with-a-trophy.

- Shape: `rounded-full px-4 py-2`, label `font-data 11px uppercase tracking-[0.14em]`, with a 10 px dot.
- **Competitive** → good trio. **Borderline** → flag (amber) trio. **Below pass** → alert trio.
- The verdict is the *only* large colour moment on the page. Pair it with one factual sentence ("2 of 3 examiners placed this in the Borderline band").
- Never imply certainty beyond the data. If examiners disagreed, show the range ("Borderline to Competitive").

### 9.2 Score tile (×7)

Separate (not joined) tiles: `rounded-[12px] border border-gp-border bg-gp-card p-4`, no hover lift.

- Top: dimension name, `font-data` 10.5 px uppercase muted (Thesis, Outline, Argument, Evidence, Counter-argument, Coherence, Language).
- Middle: the score, large (`text-[28px] font-bold`), in `.font-data` tabular, e.g. `6.5` with a muted `/ 10`.
- Bottom: a 4 px **meter bar** (`rounded-full bg-gp-border`, fill in the band colour), and a band word in the matching `-text` colour.
- Grid: `grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7`, with the last tile `col-span-2 sm:col-span-1` so seven tiles never leave an orphan. Tiles are focusable only if they reveal detail.
- State is **computed from the score** by one band function; never hard-coded.

### 9.3 Highlighted essay view

The most important new component.

- Render each paragraph as a `<p>` with `text-[17px] leading-[1.8] text-gp-text`, `max-w-[68ch]`, with a small `font-data` paragraph number in the left gutter (e.g. `P3`) that also anchors the structure and chart sections.
- Highlights are **focusable inline spans** (`role="button"`, `tabIndex={0}`, `aria-describedby` to the reason). Style by tone:

| Tone | Background | Underline (so colour is not the only cue) |
|---|---|---|
| Strong | `--gp-good-wash` | solid, 2 px, `--gp-good` |
| Weak or generic | `--gp-flag-wash` | **dashed**, 2 px, `--gp-flag` |
| Off-topic, unsupported, filler | `--gp-alert-wash` | **wavy**, 2 px, `--gp-alert` |

  Use `text-decoration: underline <style> <colour>; text-underline-offset: 3px; border-radius: 3px; padding: 0 2px;` and `box-decoration-break: clone` so multi-line highlights wrap cleanly.
- **Reason popover** (hover on desktop, focus or tap elsewhere): `rounded-[10px] border border-gp-border bg-gp-card p-3`, `shadow elev-3`, max 280 px, a tone icon and label (`font-data` uppercase), one or two short sentences in `--gp-text-secondary`. Dismiss with Escape or tap outside. On phones use a bottom sheet instead of a floating popover.
- **Legend and filter:** three chips above the text (`rounded-full border`, with the tone swatch and a count). Toggling a chip dims the other highlights to 40% opacity.
- Overlaps: nest rather than overlap; the narrower span wins on top.
- If a paragraph has no highlights, say nothing; do not invent any.

### 9.4 Labelling mock data and AI limits

- Until real analysis exists, show a dismissible-but-restorable amber banner above the report (the amber *flag* style with a dashed border): "Example report. These scores and highlights are sample data, not an analysis of your essay."
- Placeholder limitation wording (to be replaced with owner-approved text): "Galti Pakar gives AI-assisted practice feedback. It is not an official examiner's mark and does not predict your result in the CSS examination. Use it to find weak points, not as a final score."
- **Never** present a number as authoritative that came from mock data.

### 9.5 Examiner panel

Builds trust in the scoring.

- A compact list, one row per examiner ("Examiner A", "B", "C"; label them as AI): overall band pill, overall score, and a thin row of seven mini-dots (one per dimension) showing each dimension's band colour.
- A **computed agreement line** above the list, derived from the scores by a rule you define in one function. Example: *all within one band → "Examiners agree"; otherwise "Examiners differ on: Evidence, Counter-argument"*. The summary tile (§8.3 B) uses the same function.
- Where they disagree, mark the disagreeing dimensions with the amber flag, not red; disagreement is information, not an error.
- Heading: eyebrow "Examiner panel", `h2` "Three examiners scored this independently".
- If only one examiner ran, say so plainly ("Scored by one examiner") and show the dash state; never imply a panel.

### 9.6 Topic-drift line chart (hand-built SVG)

No chart library. Build it with SVG so it follows the theme tokens.

- **Axes:** x = paragraph number (`P1 … Pn`), y = relevance to the topic, 0–100. Axis labels in `.font-data` 10 px muted. Light horizontal grid lines at 25, 50 and 75 in `--gp-border`.
- **Line:** `stroke: var(--gp-accent)`, 2.5 px, round joins. A faint area fill under it (`--gp-accent-wash`). Points are 5 px circles with a 2 px surface-coloured ring.
- **Threshold:** a dashed horizontal line at the drift threshold (for example 50) labelled "Drift threshold" in muted text.
- **Flagged paragraphs** (below the threshold): the point becomes an `--gp-alert` filled circle with a 10 px halo ring, a small vertical hairline to the axis, and a short label ("P4 drifts"). Hover or focus shows a tooltip with the relevance value and a one-line reason.
- Make each point a focusable element with an accessible name ("Paragraph 4, relevance 38, drifts from the topic").
- Responsive via `viewBox`; the chart scales to its container and keeps a minimum height of about 220 px. Beneath the chart, always add a plain-text sentence that states the finding ("Paragraphs 4 and 5 drift from the topic"), so the chart is never the only carrier of the message.
- The line draws itself once on load using the `.gp-draw` stroke-dash pattern; under reduced motion it renders already drawn.

### 9.7 Structure breakdown (tagged outline)

A compact vertical list, one row per paragraph (number, role, summary, reference).

- Row: paragraph number `P1` (`font-data` accent), a **tag pill** (`rounded-full`, `font-data` 10 px uppercase) naming its role: **Position**, **Claim**, **Evidence**, **Counter-argument**, **Conclusion**; a one-line summary; and a link-style reference that scrolls to that paragraph in the essay.
- Tags are **neutral outlined pills** (`border border-gp-border-strong text-gp-text-secondary`), not a rainbow. Keep colour for meaning only.
- **Computed gaps:** if an expected role is missing (no counter-argument, no conclusion), add an amber flag row at the end: "No counter-argument found". Do not add a tick for roles that are present; presence is the default.
- Connect the rows with a thin vertical rail (`bg-gp-border`), so it reads as an outline rather than a table.

### 9.8 Top 3 fixes

Use the **numbered step cards** pattern (§7.10), three across on `lg` and stacked on phones. Each card: a mono rank (`01`), a short imperative title ("Add one counter-argument"), a sentence of explanation, and a small link to the affected paragraph ("See P4"). Order by impact, highest first. State the basis for the ranking in one muted line ("Ranked by estimated effect on your score").

### 9.9 Before and after (diff)

- Two panels side by side from `md`, stacked on phones: **Your paragraph** (left, tone card with an amber rail) and **A stronger version** (right, tone card with a green rail). Each has a `font-data` label and the paragraph in `text-[16px] leading-[1.75]`.
- Optional inline diff: in the original, removed or weak phrases get the alert wash with a strike-through; in the rewrite, added phrases get the good wash. Colour plus the underline or strike style (never colour alone).
- A **Show changes** toggle (default on) switches the markers off for plain reading.
- A short note under it: "This rewrite is a model example, not a replacement for your own words." Label it clearly as machine-written.
- A Copy button for each panel (`navigator.clipboard.writeText` inside the click handler, with a fallback if it rejects).

---

## 10. Data shapes and mock data

Build the UI against these types. Put one realistic mock report behind `getReport(id)` and one `getHistory()`, so a real API can replace them.

```ts
export type Band = "competitive" | "borderline" | "below-pass";
export type Tone = "strong" | "weak" | "offtopic";
export type ParagraphRole = "position" | "claim" | "evidence" | "counter-argument" | "conclusion";

export type RubricKey = "thesis" | "outline" | "argument" | "evidence" | "counter-argument" | "coherence" | "language";

export interface DimensionScore { key: RubricKey; label: string; score: number; outOf: number; band: Band; note?: string }

export interface HighlightSpan { start: number; end: number; tone: Tone; reason: string } // character offsets in the paragraph text

export interface Paragraph {
  id: string;            // "p1"
  text: string;
  role: ParagraphRole;
  relevance: number;     // 0–100, relevance to the topic
  summary: string;       // one line for the structure list
  spans: HighlightSpan[];
}

export interface Fix { rank: 1 | 2 | 3; title: string; body: string; paragraphId?: string }

export interface Rewrite { paragraphId: string; original: string; improved: string }

export interface ExaminerResult { id: string; label: string; overall: number; band: Band; dimensions: Record<RubricKey, Band> }

export interface EssayReport {
  id: string;
  topic: string;
  analysedAt: string;          // ISO
  wordCount: number;
  pageCount: number;
  overallScore: number;
  overallOutOf: number;
  verdict: Band;
  dimensions: DimensionScore[]; // 7
  paragraphs: Paragraph[];
  driftThreshold: number;       // e.g. 50
  fixes: Fix[];                 // 3
  rewrite: Rewrite;
  examiners: ExaminerResult[];  // 1–5
  isExample: boolean;           // true for mock data; drives the §9.4 banner
}
```

Derive, never store: the **band for a score**, the **drifting paragraphs** (`relevance < driftThreshold`), the **missing structure roles**, the **examiners-agree rule**, the **highlight counts** for the legend. One small pure function for each, unit-tested.

Mock report guidance: use a plausible CSS-style topic ("Climate change and Pakistan's economic future"), 7 to 9 paragraphs of real-sounding essay prose (about 800 to 1,000 words), at least two paragraphs that drift, one missing counter-argument case, and examiners that disagree on one dimension, so every state is visible.

---

## 11. Accessibility and responsive behaviour

- **Contrast:** every pair in this brief meets WCAG AA; the essay text on highlights exceeds 11:1.
- **Not colour alone:** underline style, icon and text label accompany every colour signal (highlights, band pills, flags, chart points).
- **Keyboard:** every highlight, chart point, tab-like control and popover is reachable and operable; Escape closes popovers; a visible 2 px focus ring everywhere.
- **Screen readers:** `aria-live="polite"` on the processing stepper; `role="alert"` on errors; chart points and highlights have accessible names; the chart's finding is also stated in plain text.
- **Touch:** 44 px minimum targets; highlights have enough padding to tap inline.
- **Reading comfort:** essay text `68ch` max width, 17 px, line-height 1.8.
- **Responsive:** phone first at about 390 px. Scorecard 2 → 4 → 7 columns. Before and after stack below `md`. The reason panel is a bottom sheet on phones. Use `100dvh` for full-screen states so mobile browser bars do not clip content.
- **Reduced motion:** honoured everywhere (§5).
- **Print:** the report should print cleanly (hide the toolbar and filters, keep highlights with their underline styles), since candidates may print feedback.

---

## 12. Acceptance checklist

1. Every colour comes from a token. No raw hex, no raw `green-*`, `red-*` or `amber-*` classes in components.
2. Teal is used only for actions, focus and live state. "Strong" is green; teal never means good.
3. Light and dark both work, with no flash of the wrong theme; the photo frames stay dark in both.
4. Typography is Plus Jakarta Sans plus IBM Plex Mono only; labels are uppercase, wide-tracked, and mono.
5. The report has this anatomy: header, key facts, a joined summary strip, titled sections with section rules, limitation note.
6. Every badge, band, count and agreement indicator is computed from the data.
7. Highlights differ by underline style as well as colour; popovers work by hover, focus and tap.
8. The drift chart is hand-built SVG, follows the theme, flags drifting paragraphs, and states its finding in text.
9. The processing screen shows real named steps with pending, active and done states, never a bare spinner.
10. Mock data is labelled as an example everywhere it appears, and the AI limitation note is present.
11. Touch targets are at least 44 px; the whole flow works at 390 px wide.
12. Reduced motion is respected; nothing important is hidden behind an animation.
13. Honest test: would you believe a real design team made this, or is it a generator's first draft?

---

# Appendix A: Paste-ready CSS (tokens, utilities, motion)

Put this in `globals.css`. It uses Tailwind v4; the `@theme inline` block maps tokens to utilities such as `bg-gp-card` and `text-gp-accent-text`.

```css
@import "tailwindcss";

:root {
  /* ---- core (light) ---- */
  --gp-bg: #f2f6f6;
  --gp-bg-field: radial-gradient(circle at 65% 55%, #ffffff 0%, #f2f6f6 55%, #e9efef 100%);
  --gp-surface: #ffffff;
  --gp-surface-raised: #ffffff;
  --gp-card: #ffffff;
  --gp-border: rgba(13, 148, 136, 0.18);
  --gp-border-strong: rgba(13, 148, 136, 0.34);

  --gp-text: #0b1a1e;
  --gp-text-secondary: #3f5157;
  --gp-text-muted: #4b5c62;

  --gp-accent: #2dd4bf;
  --gp-accent-text: #0f766e;
  --gp-accent-strong: #0f766e;
  --gp-accent-hover: #115e59;
  --gp-accent-bright: #28e5d2;
  --gp-accent-glow: #00f7d4;
  --gp-on-accent: #ffffff;
  --gp-accent-wash: rgba(45, 212, 191, 0.1);

  /* ---- highlight trios: wash / text / solid ---- */
  --gp-good: #15803d;
  --gp-good-wash: rgba(22, 163, 74, 0.16);
  --gp-good-text: #166534;

  --gp-flag: #f6ae31;
  --gp-flag-wash: #fef9f0;
  --gp-flag-text: #6c4604;

  --gp-alert: #b91c1c;
  --gp-alert-wash: rgba(220, 38, 38, 0.12);
  --gp-alert-text: #991b1b;

  /* ---- device / media surfaces: dark in BOTH themes ---- */
  --gp-device-bg: #070c12;
  --gp-device-surface: #08121d;
  --gp-device-border: rgba(6, 182, 212, 0.2);
  --gp-device-text: #f1f5f9;
  --gp-device-muted: #94a3b8;

  /* ---- elevation and glow ---- */
  --gp-elev-1: 0 1px 2px rgba(11, 26, 30, 0.06);
  --gp-elev-2: 0 6px 20px rgba(11, 26, 30, 0.07), 0 1px 3px rgba(11, 26, 30, 0.05);
  --gp-elev-3: 0 18px 44px rgba(11, 26, 30, 0.1), 0 4px 10px rgba(11, 26, 30, 0.05);
  --gp-glow-cta: 0 0 24px rgba(45, 212, 191, 0.35);
  --gp-glow-hover: 0 0 24px rgba(45, 212, 191, 0.4);

  --gp-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --gp-ease-inout: cubic-bezier(0.4, 0, 0.2, 1);
  color-scheme: light;
}

[data-theme="dark"] {
  --gp-bg: #070c12;
  --gp-bg-field: radial-gradient(circle at 65% 55%, #102131 0%, #0b1522 45%, #070c12 90%);
  --gp-surface: #0b1622;
  --gp-surface-raised: #0c1421;
  --gp-card: #08121d;
  --gp-border: rgba(6, 182, 212, 0.2);
  --gp-border-strong: rgba(6, 182, 212, 0.38);

  --gp-text: #f1f5f9;
  --gp-text-secondary: #cbd5e1;
  --gp-text-muted: #94a3b8;

  --gp-accent: #2dd4bf;
  --gp-accent-text: #2dd4bf;
  --gp-accent-strong: #2dd4bf;
  --gp-accent-hover: #20cfbd;
  --gp-on-accent: #06181d;
  --gp-accent-wash: rgba(45, 212, 191, 0.1);

  --gp-good: #4ade80;
  --gp-good-wash: rgba(74, 222, 128, 0.16);
  --gp-good-text: #86efac;

  --gp-flag-wash: rgba(246, 174, 49, 0.12);
  --gp-flag-text: #fbd593;

  --gp-alert: #f87171;
  --gp-alert-wash: rgba(248, 113, 113, 0.16);
  --gp-alert-text: #fca5a5;

  --gp-elev-1: 0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.05);
  --gp-elev-2: 0 4px 24px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.05);
  --gp-elev-3: 0 24px 64px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.05);
  --gp-glow-hover: 0 0 32px rgba(45, 212, 191, 0.55);
  color-scheme: dark;
}

@theme inline {
  --color-gp-bg: var(--gp-bg);
  --color-gp-surface: var(--gp-surface);
  --color-gp-surface-raised: var(--gp-surface-raised);
  --color-gp-card: var(--gp-card);
  --color-gp-border: var(--gp-border);
  --color-gp-border-strong: var(--gp-border-strong);
  --color-gp-text: var(--gp-text);
  --color-gp-text-secondary: var(--gp-text-secondary);
  --color-gp-text-muted: var(--gp-text-muted);
  --color-gp-accent: var(--gp-accent);
  --color-gp-accent-text: var(--gp-accent-text);
  --color-gp-accent-strong: var(--gp-accent-strong);
  --color-gp-accent-hover: var(--gp-accent-hover);
  --color-gp-accent-bright: var(--gp-accent-bright);
  --color-gp-accent-glow: var(--gp-accent-glow);
  --color-gp-on-accent: var(--gp-on-accent);
  --color-gp-accent-wash: var(--gp-accent-wash);
  --color-gp-good: var(--gp-good);
  --color-gp-good-wash: var(--gp-good-wash);
  --color-gp-good-text: var(--gp-good-text);
  --color-gp-flag: var(--gp-flag);
  --color-gp-flag-wash: var(--gp-flag-wash);
  --color-gp-flag-text: var(--gp-flag-text);
  --color-gp-alert: var(--gp-alert);
  --color-gp-alert-wash: var(--gp-alert-wash);
  --color-gp-alert-text: var(--gp-alert-text);
  --color-gp-device-bg: var(--gp-device-bg);
  --color-gp-device-surface: var(--gp-device-surface);
  --color-gp-device-border: var(--gp-device-border);
  --color-gp-device-text: var(--gp-device-text);
  --color-gp-device-muted: var(--gp-device-muted);
  --font-sans: var(--font-jakarta);
  --font-mono: var(--font-data);
}

body { background: var(--gp-bg); color: var(--gp-text); font-family: var(--font-jakarta), system-ui, sans-serif; }
h1, h2, h3, h4, .gp-display { letter-spacing: -0.02em; }
.font-data { font-family: var(--font-data), ui-monospace, monospace; font-variant-numeric: tabular-nums; }

/* ---- interaction ---- */
.gp-btn-primary { transition: transform .2s var(--gp-ease-inout), box-shadow .2s var(--gp-ease-inout), background-color .2s var(--gp-ease-inout); }
.gp-btn-primary:hover { transform: translateY(-2px); box-shadow: var(--gp-glow-hover); }
.gp-btn-primary:active { transform: translateY(0) scale(.98); transition-duration: .1s; }
.gp-btn-ghost { transition: transform .2s var(--gp-ease-inout), border-color .2s var(--gp-ease-inout), color .2s var(--gp-ease-inout); }
.gp-btn-ghost:hover { transform: translateY(-2px); border-color: var(--gp-accent); }
.gp-btn-ghost:active { transform: translateY(0) scale(.98); transition-duration: .1s; }
.gp-card { transition: transform .25s var(--gp-ease-inout), border-color .25s var(--gp-ease-inout), box-shadow .25s var(--gp-ease-inout), background-color .25s var(--gp-ease-inout); }
.gp-card:hover { transform: translateY(-4px); border-color: var(--gp-border-strong); background: var(--gp-surface-raised); box-shadow: var(--gp-elev-3); }
:focus-visible { outline: 2px solid var(--gp-accent); outline-offset: 3px; border-radius: 4px; }

/* ---- load entrances ---- */
@keyframes gp-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@keyframes gp-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes gp-scale-in { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
.gp-enter-rise { animation: gp-rise .9s var(--gp-ease-out) both; }
.gp-enter-fade { animation: gp-fade .7s var(--gp-ease-out) both; }
.gp-enter-scale { animation: gp-scale-in 1.1s var(--gp-ease-out) both; }

/* ---- scroll reveals (toggle .is-visible with IntersectionObserver) ---- */
.gp-reveal, .gp-reveal-left, .gp-reveal-scale { opacity: 0; transition: opacity .8s var(--gp-ease-out), transform .8s var(--gp-ease-out); }
.gp-reveal { transform: translateY(32px); }
.gp-reveal-left { transform: translateX(-28px); }
.gp-reveal-scale { transform: scale(.96); }
.gp-reveal.is-visible, .gp-reveal-left.is-visible, .gp-reveal-scale.is-visible { opacity: 1; transform: none; }

/* ---- chart line draws itself once ---- */
@keyframes gp-draw-stroke { to { stroke-dashoffset: 0; } }
.gp-draw { stroke-dasharray: 1600; stroke-dashoffset: 1600; animation: gp-draw-stroke 2.4s var(--gp-ease-out) .35s forwards; }

/* ---- essay highlights: colour AND underline style ---- */
.hl { border-radius: 3px; padding: 0 2px; cursor: pointer; text-underline-offset: 3px; text-decoration-thickness: 2px; text-decoration-line: underline; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.hl-strong  { background: var(--gp-good-wash);  text-decoration-style: solid;  text-decoration-color: var(--gp-good); }
.hl-weak    { background: var(--gp-flag-wash);  text-decoration-style: dashed; text-decoration-color: var(--gp-flag); }
.hl-offtopic{ background: var(--gp-alert-wash); text-decoration-style: wavy;   text-decoration-color: var(--gp-alert); }

/* ---- reduced motion: land in the end state ---- */
@media (prefers-reduced-motion: reduce) {
  .gp-enter-rise, .gp-enter-fade, .gp-enter-scale { animation: none; opacity: 1; transform: none; }
  .gp-reveal, .gp-reveal-left, .gp-reveal-scale { opacity: 1; transform: none; transition: none; }
  .gp-draw { animation: none; stroke-dasharray: none; stroke-dashoffset: 0; }
  .gp-btn-primary, .gp-btn-ghost, .gp-card { transition-duration: .01ms; }
}
```

Fonts in `layout.tsx`:

```tsx
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400","500","600","700","800"] });
const mono = IBM_Plex_Mono({ variable: "--font-data", subsets: ["latin"], weight: ["400","500"] });
// <html lang="en" suppressHydrationWarning className={`${jakarta.variable} ${mono.variable}`}>
//   <body suppressHydrationWarning>…</body>
```

Pre-paint theme script (inline in `<head>`):

```html
<script>
  try {
    var t = localStorage.getItem("gp-theme");
    if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) { document.documentElement.setAttribute("data-theme", "light"); }
</script>
```

"use client";

import { Fragment, useState, type ReactNode } from "react";
import { BAND_LABEL, examinerAgreement, missingRoles } from "@/lib/derive";
import type { Band, EssayReport, ParagraphRole, RubricKey } from "@/lib/types";
import type { ReportExtras } from "@/lib/types.extras";
import { BandPill, Button, StateIcon, ToneCard, bandStyle, stateText } from "@/components/ui";

/* ---------- summary strip (joined tiles) ---------- */

export function SummaryStrip({ report }: { report: EssayReport }) {
  const a = examinerAgreement(report.examiners);
  const hasRuns = report.examiners.length > 0;
  const tiles = [
    { label: "Overall score", value: `${report.overallScore.toFixed(1)} / ${report.overallOutOf}`, state: "ok" as const, bandText: bandStyle[report.verdict].text },
    // With no AI runs there is nothing to agree on, so the tile is left out rather than showing "None".
    ...(hasRuns ? [{ label: "AI runs agree", value: a.total ? `${a.modalCount} of ${a.total}` : "None", state: a.state }] : []),
  ];
  return (
    <div className={`grid gap-px overflow-hidden rounded-[12px] border border-v-border bg-v-border max-w-md ${hasRuns ? "grid-cols-2" : "grid-cols-1"}`}>
      {tiles.map((t) => (
        <div key={t.label} className="bg-v-surface px-4 py-4 text-center">
          <div className="mb-1.5 flex justify-center">
            <StateIcon state={t.state} />
          </div>
          <p className={`font-data text-[22px] font-bold leading-none ${t.bandText ?? stateText[t.state]}`}>{t.value}</p>
          <p className="mt-1.5 font-data text-[10.5px] font-semibold uppercase tracking-[0.1em] text-v-text-muted">{t.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------- scorecard ---------- */

export function Scorecard({ report }: { report: EssayReport }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {report.dimensions.map((d, i) => (
        <li
          key={d.key}
          className={`rounded-[12px] border border-v-border bg-v-card p-4 ${i === report.dimensions.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}
        >
          <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.1em] text-v-text-muted">{d.label}</p>
          <p className="mt-2 font-data text-[28px] font-bold leading-none text-v-text">
            {d.score.toFixed(1)}
            <span className="ml-1 text-[12px] font-medium text-v-text-muted">/ {d.outOf}</span>
          </p>
          <div className="mt-3 h-1 rounded-full bg-v-border" role="img" aria-label={`${d.score} out of ${d.outOf}`}>
            <div className={`h-1 rounded-full ${bandStyle[d.band].fill}`} style={{ width: `${(d.score / d.outOf) * 100}%` }} />
          </div>
          <p className={`mt-2 text-[12.5px] font-semibold ${bandStyle[d.band].text}`}>{BAND_LABEL[d.band]}</p>
          {d.note && <p className="mt-1.5 text-[12px] leading-snug text-v-text-muted">{d.note}</p>}
        </li>
      ))}
    </ul>
  );
}

/* ---------- structure ---------- */

const ROLE_LABEL: Record<ParagraphRole, string> = {
  position: "Position",
  claim: "Claim",
  evidence: "Evidence",
  "counter-argument": "Counter-argument",
  conclusion: "Conclusion",
};

export function Structure({ report }: { report: EssayReport }) {
  const gaps = missingRoles(report.paragraphs);
  return (
    <div>
      <ol className="relative space-y-3 pl-0">
        <span className="absolute bottom-3 left-[15px] top-3 w-px bg-v-border" aria-hidden />
        {report.paragraphs.map((p, i) => (
          <li key={p.id} className="relative flex items-start gap-3">
            <span className="relative z-10 w-8 shrink-0 bg-v-bg py-1 text-center font-data text-[11px] font-bold text-v-accent-text">P{i + 1}</span>
            <div className="min-w-0 flex-1 rounded-[10px] border border-v-border bg-v-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="rounded-full border border-v-border-strong px-2.5 py-0.5 font-data text-[10px] font-bold uppercase tracking-[0.12em] text-v-text-secondary">
                  {ROLE_LABEL[p.role]}
                </span>
                <a href={`#${p.id}`} className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-v-accent-text underline underline-offset-4 sm:ml-auto sm:min-h-0">
                  See in essay
                </a>
              </div>
              <p className="mt-1.5 text-[14px] leading-snug text-v-text-secondary">{p.summary}</p>
            </div>
          </li>
        ))}
        {gaps.map((g) => (
          <li key={g} className="relative flex items-start gap-3">
            <span className="relative z-10 grid w-8 shrink-0 place-items-center bg-v-bg py-1">
              <StateIcon state="partial" size={16} />
            </span>
            <div className="min-w-0 flex-1 rounded-[10px] border border-v-flag bg-v-flag-wash px-4 py-3">
              <p className="text-[14px] font-semibold text-v-flag-text">No {ROLE_LABEL[g].toLowerCase()} found</p>
              <p className="mt-0.5 text-[13px] text-v-flag-text">None of your paragraphs plays this role.</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- top 3 fixes ---------- */

export function Fixes({ report }: { report: EssayReport }) {
  return (
    <div>
      <ol className="grid gap-4 lg:grid-cols-3">
        {[...report.fixes].sort((a, b) => a.rank - b.rank).map((f) => (
          <li key={f.rank} className="rounded-[10px] border border-v-border bg-v-card px-4 py-3.5">
            <p className="font-data text-[10px] font-bold tracking-[0.14em] text-v-accent-text">{String(f.rank).padStart(2, "0")}</p>
            <p className="mt-1.5 text-[15px] font-bold leading-tight text-v-text">{f.title}</p>
            <p className="mt-1.5 text-[13px] leading-snug text-v-text-secondary">{f.body}</p>
            {f.paragraphId && (
              <a href={`#${f.paragraphId}`} className="mt-2 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-v-accent-text underline underline-offset-4">
                See P{report.paragraphs.findIndex((p) => p.id === f.paragraphId) + 1}
              </a>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12.5px] text-v-text-muted">Ranked by estimated effect on your score.</p>
    </div>
  );
}

/* ---------- before / after ---------- */

function marked(text: string, phrases: string[] | undefined, cls: string, on: boolean) {
  if (!on || !phrases?.length) return text;
  const hits = phrases
    .map((ph) => ({ ph, at: text.indexOf(ph) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  const out: React.ReactNode[] = [];
  let cur = 0;
  hits.forEach((h, i) => {
    if (h.at < cur) return;
    if (h.at > cur) out.push(<Fragment key={`a${i}`}>{text.slice(cur, h.at)}</Fragment>);
    out.push(<span key={`m${i}`} className={cls}>{h.ph}</span>);
    cur = h.at + h.ph.length;
  });
  out.push(<Fragment key="z">{text.slice(cur)}</Fragment>);
  return out;
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        setState(ok ? "done" : "failed");
      } catch {
        setState("failed");
      }
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button type="button" onClick={copy} className="no-print mt-3 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-v-accent-text underline underline-offset-4" aria-live="polite">
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed. Select the text instead." : "Copy"}
    </button>
  );
}

const SLOT_RE = /\[[^\[\]]+\]/g;

/**
 * The improved paragraph with bracketed slots drawn as dashed chips (a slot is a prompt to add a verified fact of your
 * own) and, when "Show changes" is on, added phrases marked. Slots are never split by a diff boundary.
 */
function renderImproved(text: string, original: string, added: string[] | undefined, changes: boolean): ReactNode[] {
  const slots = [...text.matchAll(SLOT_RE)].filter((m) => !original.includes(m[0])).map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  const adds: { start: number; end: number }[] = [];
  if (changes) {
    for (const ph of added ?? []) {
      const at = text.indexOf(ph);
      if (at < 0) continue;
      let start = at;
      let end = at + ph.length;
      for (const sl of slots) if (start < sl.end && end > sl.start) { start = Math.min(start, sl.start); end = Math.max(end, sl.end); }
      adds.push({ start, end });
    }
  }
  const cuts = new Set<number>([0, text.length]);
  for (const r of [...slots, ...adds]) { cuts.add(r.start); cuts.add(r.end); }
  const pts = [...cuts].sort((x, y) => x - y);
  const out: ReactNode[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x, y] = [pts[i], pts[i + 1]];
    const seg = text.slice(x, y);
    const inSlot = slots.some((r) => r.start <= x && r.end >= y);
    const inAdd = adds.some((r) => r.start <= x && r.end >= y);
    if (inSlot)
      out.push(
        <span key={i} className={`slot tip ${inAdd ? "diff-add" : ""}`} tabIndex={0} data-tip="Add a verified fact of your own" aria-label={`${seg}. Add a verified fact of your own.`}>
          {seg}
        </span>,
      );
    else if (inAdd) out.push(<span key={i} className="diff-add">{seg}</span>);
    else out.push(<Fragment key={i}>{seg}</Fragment>);
  }
  return out;
}

export function BeforeAfter({ report, rewriteExtras }: { report: EssayReport; rewriteExtras?: ReportExtras["rewriteExtras"] }) {
  const [changes, setChanges] = useState(true);
  const r = report.rewrite;
  const n = report.paragraphs.findIndex((p) => p.id === r.paragraphId) + 1;
  const notes = rewriteExtras?.changeNotes ?? [];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13.5px] text-v-text-secondary">Paragraph {n}, the weakest on-page paragraph.</p>
        <button
          type="button"
          role="switch"
          aria-checked={changes}
          onClick={() => setChanges((c) => !c)}
          className="no-print inline-flex min-h-[44px] items-center gap-2 rounded-full border border-v-border-strong px-4 text-[13px] font-semibold text-v-text"
        >
          <span className={`h-3 w-3 rounded-full ${changes ? "bg-v-accent-strong" : "border border-v-text-muted"}`} aria-hidden />
          Show changes
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ToneCard title="Your paragraph" tone="flag">
          <p className="text-[16px] leading-[1.75] text-v-text">{marked(r.original, r.removed, "diff-del", changes)}</p>
          <CopyButton text={r.original} />
        </ToneCard>
        <ToneCard title="A stronger version (machine-written)" tone="good">
          <p className="text-[16px] leading-[1.75] text-v-text">{renderImproved(r.improved, r.original, r.added, changes)}</p>
          <CopyButton text={r.improved} />
        </ToneCard>
      </div>
      {notes.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-v-border bg-v-surface p-4">
          <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-accent-text">What changed and why</p>
          <ul className="mt-2 space-y-2">
            {notes.map((c, i) => (
              <li key={i} className="text-[14px] leading-snug text-v-text-secondary">
                <span className="font-semibold text-v-text">{c.what}</span> {c.why}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[12.5px] text-v-text-muted">Model paragraph for practice. In the exam, write your own. It is written by AI and is not a replacement for your own words.</p>
    </div>
  );
}

/* ---------- examiner panel ---------- */

const DIM_LABEL: Record<RubricKey, string> = {
  thesis: "Thesis",
  outline: "Outline",
  argument: "Argument",
  evidence: "Evidence",
  "counter-argument": "Counter-argument",
  coherence: "Coherence",
  language: "Language",
};

/** Display label for an AI run: older data calls them "Examiner A", which would suggest independent people. */
export const runLabel = (label: string) => label.replace(/^Examiner/i, "AI run");

export function ExaminerPanel({ report }: { report: EssayReport }) {
  const a = examinerAgreement(report.examiners);
  const keys = Object.keys(DIM_LABEL) as RubricKey[];
  const names = a.differing.map((k) => DIM_LABEL[k]);
  return (
    <div>
      {a.total === 1 ? (
        <p className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-v-text">
          <StateIcon state="absent" /> Scored by one AI run
        </p>
      ) : (
        <p className="mb-4 flex items-start gap-2 text-[15px] font-semibold text-v-text">
          <span className="mt-1 shrink-0"><StateIcon state={a.state} /></span>
          {a.agree ? "AI runs agree" : `AI runs differ on: ${names.join(", ")}`}
        </p>
      )}
      <ul className="space-y-2">
        {report.examiners.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-v-border bg-v-card px-4 py-3">
            <div className="min-w-[130px]">
              <p className="text-[14px] font-bold text-v-text">{runLabel(e.label)}</p>
              <p className="font-data text-[10px] uppercase tracking-[0.12em] text-v-text-muted">AI run</p>
            </div>
            <BandPill band={e.band} small />
            <span className="font-data text-[16px] font-bold text-v-text">{e.overall.toFixed(1)}<span className="text-[11px] font-medium text-v-text-muted"> / {report.overallOutOf}</span></span>
            <ul className="ml-auto flex items-center gap-1.5" aria-label="Band per dimension">
              {keys.map((k) => {
                const differs = a.differing.includes(k);
                return (
                  <li
                    key={k}
                    title={`${DIM_LABEL[k]}: ${BAND_LABEL[e.dimensions[k]]}`}
                    aria-label={`${DIM_LABEL[k]}: ${BAND_LABEL[e.dimensions[k]]}${differs ? ", AI runs differ" : ""}`}
                    className={`h-3 w-3 rounded-full ${bandStyle[e.dimensions[k]].dot} ${differs ? "ring-2 ring-v-flag ring-offset-2 ring-offset-v-card" : ""}`}
                  />
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-v-text-muted">
        Dots run in rubric order: {keys.map((k) => DIM_LABEL[k]).join(", ")}. An amber ring marks a dimension where the AI runs differ. These are repeated runs of the same AI model, so they are not independent opinions. Disagreement is information, not an error.
      </p>
    </div>
  );
}

export function verdictSentence(report: EssayReport): { range: string; text: string } {
  // Without any AI run (a partial analysis) the verdict rests on the measurements alone, and the page says so.
  if (report.examiners.length === 0) return { range: BAND_LABEL[report.verdict], text: "This verdict comes from the measured analysis only; no AI examiner scores are included." };
  const a = examinerAgreement(report.examiners);
  const [lo, hi] = a.range;
  const range = lo === hi ? BAND_LABEL[lo] : `${BAND_LABEL[lo]} to ${BAND_LABEL[hi]}`;
  const counts: Partial<Record<Band, number>> = {};
  report.examiners.forEach((e) => (counts[e.band] = (counts[e.band] ?? 0) + 1));
  const top = (Object.entries(counts) as [Band, number][]).sort((x, y) => y[1] - x[1])[0];
  const text =
    a.total === 1
      ? `One AI run placed this in the ${BAND_LABEL[top[0]]} band.`
      : `${top[1]} of ${a.total} AI runs placed this in the ${BAND_LABEL[top[0]]} band.`;
  return { range, text };
}

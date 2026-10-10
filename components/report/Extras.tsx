"use client";

import { rangeSentence } from "@/lib/client/status";
import type { BenchmarkInfo, ExtraConflict, ReportExtras, VerificationInfo } from "@/lib/types.extras";
import type { EssayReport } from "@/lib/types";

/* ---------- transcription banner ---------- */

export function TranscriptionBanner({ info }: { info?: ReportExtras["transcription"] }) {
  if (!info || info.legibility === "good") return null;
  return (
    <div role="note" className="mb-6 flex items-start gap-3 rounded-[10px] border border-v-flag bg-v-flag-wash px-4 py-3">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="mt-[1px] shrink-0 text-v-flag-text" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 7v6M12 17h.01" />
      </svg>
      <p className="text-sm leading-snug text-v-flag-text">
        Some handwriting was hard to read, so parts of this analysis may be off.
        {info.uncertain.length > 0 && " Words with a dotted underline in your essay are the ones we were unsure of."}
      </p>
    </div>
  );
}

/* ---------- storage note ---------- */

export function NotSavedNote() {
  return (
    <p role="note" className="no-print mb-6 rounded-[10px] border border-v-border bg-v-surface px-4 py-3 text-sm text-v-text-secondary">
      This report can&apos;t be saved on this device. It will be gone when you close or reload this tab.
    </p>
  );
}

/* ---------- conflicts ---------- */

export function ConflictsList({ conflicts, report }: { conflicts?: ExtraConflict[]; report: EssayReport }) {
  if (!conflicts) return null; // nothing at all when the backend did not say
  const label = (d: string) => report.dimensions.find((x) => x.key === d || x.label.toLowerCase() === d.toLowerCase())?.label ?? d;
  return (
    <div className="mt-8">
      <h3 className="text-[17px] font-bold text-v-text">Where the measurements and the AI examiner disagreed</h3>
      {conflicts.length === 0 ? (
        <p className="mt-2 text-[14px] text-v-text-secondary">No disagreements found.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {conflicts.map((c) => (
            <li key={c.id} className="rounded-[12px] border border-v-border border-l-4 border-l-v-flag bg-v-card p-4">
              <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-flag-text">{label(c.dimension)}</p>
              <dl className="mt-2 grid gap-3 text-[14px] leading-snug sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-v-text">The AI examiner said</dt>
                  <dd className="mt-0.5 text-v-text-secondary">{c.examinerSays}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-v-text">The measurements found</dt>
                  <dd className="mt-0.5 text-v-text-secondary">{c.measuredSays}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12.5px] text-v-text-muted">A disagreement is information, not an error: it marks a judgement worth a second look.</p>
    </div>
  );
}

/* ---------- verification strip ---------- */

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function VerificationStrip({ v }: { v?: VerificationInfo }) {
  if (!v) return null;
  const lines: string[] = [];
  if (v.spansProposed !== undefined) {
    const removed = v.spansDropped;
    lines.push(`Checked ${v.spansProposed} highlight${v.spansProposed === 1 ? "" : "s"}${removed !== undefined ? `, removed ${removed} that did not match the essay text` : ""}.`);
  }
  if (v.quotesVerified !== undefined && v.quotesProposed !== undefined) lines.push(`Quotes verified: ${v.quotesVerified} of ${v.quotesProposed}.`);
  if (v.conflictsFound !== undefined) lines.push(`Conflicts found: ${v.conflictsFound}.`);
  if (v.examinerAgreementRate !== undefined) lines.push(`AI runs agreed on ${pct(v.examinerAgreementRate)} of the criteria.`);
  if (v.labelAgreementRate !== undefined) lines.push(`Sentence labels agreed on ${pct(v.labelAgreementRate)} of sentences.`);
  if (lines.length === 0) return null;
  return (
    <details className="group mt-8 rounded-[12px] border border-v-border bg-v-surface">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-4 py-3 text-[15px] font-bold text-v-text">
        How this analysis was checked
        <span className="font-data text-[11px] font-semibold uppercase tracking-[0.12em] text-v-accent-text group-open:hidden">Show</span>
        <span className="hidden font-data text-[11px] font-semibold uppercase tracking-[0.12em] text-v-accent-text group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-v-border px-4 py-3">
        <ul className="space-y-1.5 text-[14px] text-v-text-secondary">
          {lines.map((l) => (
            <li key={l} className="flex gap-2">
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-v-accent-strong" aria-hidden />
              {l}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12.5px] leading-snug text-v-text-muted">
          This confirms that each finding points to the exact passage in your essay. It does not prove that every judgement is correct.
        </p>
      </div>
    </details>
  );
}

/* ---------- benchmark ---------- */

function RangeBar({ row }: { row: NonNullable<BenchmarkInfo["profile"]>[number] }) {
  const { value, refQ1: q1, refQ3: q3 } = row;
  const span = Math.max(q3 - q1, Math.abs(value) * 0.2, 0.1);
  const lo = Math.min(q1, value) - span * 0.6;
  const hi = Math.max(q3, value) + span * 0.6;
  const at = (x: number) => `${((x - lo) / (hi - lo)) * 100}%`;
  const hint = row.betterDirection === "higher" ? "Higher is usually better here." : "Lower is usually better here.";
  return (
    <li className="rounded-[10px] border border-v-border bg-v-card p-3">
      <p className="text-[13.5px] font-semibold text-v-text">{row.label}</p>
      <div className="relative mt-3 h-2 rounded-full bg-v-border" role="img" aria-label={rangeSentence(row.label, value, q1, q3, row.position)}>
        <div className="absolute inset-y-0 rounded-full border border-v-accent-text/50 bg-v-accent-wash" style={{ left: at(q1), width: `calc(${at(q3)} - ${at(q1)})` }} />
        <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-v-card bg-v-text" style={{ left: at(value) }} />
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-v-text-secondary">
        {rangeSentence(row.label, value, q1, q3, row.position)} <span className="text-v-text-muted">{hint}</span>
      </p>
    </li>
  );
}

export function BenchmarkCard({ b }: { b?: BenchmarkInfo }) {
  if (!b || b.status === "unavailable") return null;
  const cov = b.coverage;
  const hasRefs = (b.nReferences ?? 0) > 0 && cov?.basis !== "llm-checklist";
  const missing = cov ? [...cov.missing].sort((x, y) => (y.madeByCount ?? -1) - (x.madeByCount ?? -1)) : [];
  if (!cov && !(b.profile && b.profile.length)) return null;
  return (
    <div className="rounded-[14px] border border-v-border bg-v-surface p-5">
      {b.themeLabel && <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-text-muted">Theme: {b.themeLabel}</p>}
      <p className="mt-1 text-[14px] leading-snug text-v-text-secondary">
        {hasRefs ? `Compared with ${b.nReferences} reference essays, not marked exam scripts.` : "Compared with an AI-written checklist for this theme, not marked exam scripts."} This does not change your score.
      </p>
      {b.status === "partial" && <p className="mt-1 text-[12.5px] text-v-text-muted">This is a partial comparison: some parts were not available.</p>}

      {cov && (
        <div className="mt-5">
          <p className="text-[16px] font-bold text-v-text">
            Covered {cov.covered} of {cov.total} key points
          </p>
          <p className="text-[12.5px] text-v-text-muted">
            {cov.basis === "reference" ? "Points made by the reference essays." : cov.basis === "mixed" ? "Points from the reference essays plus an AI-written checklist." : "Points from an AI-written checklist."}
          </p>
          {missing.length > 0 && (
            <>
              <p className="mt-4 font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-accent-text">Points your essay does not make</p>
              <ol className="mt-2 space-y-2">
                {missing.map((m, i) => (
                  <li key={i} className="rounded-[10px] border border-v-border bg-v-card px-3 py-2.5 text-[14px] leading-snug text-v-text">
                    {m.point}
                    <span className="mt-0.5 block font-data text-[11px] text-v-text-muted">
                      {m.madeByCount !== null && m.madeByCount !== undefined ? `made by ${m.madeByCount}${m.ofN ? ` of ${m.ofN}` : ""} reference essays` : "suggested by a checklist"}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      {b.profile && b.profile.length > 0 && (
        <div className="mt-5">
          <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-accent-text">Writing profile</p>
          <p className="mt-1 text-[12.5px] text-v-text-muted">The shaded band is where the middle half of reference essays fall. The dot is your essay. There is no score here.</p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {b.profile.map((r) => (
              <RangeBar key={r.label} row={r} />
            ))}
          </ul>
        </div>
      )}

      {b.disclaimers.length > 0 && (
        <ul className="mt-5 space-y-1 border-t border-v-border pt-3 text-[12.5px] text-v-text-muted">
          {b.disclaimers.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- warnings ---------- */

export function WarningsNote({ warnings }: { warnings?: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <details className="mt-8 rounded-[12px] border border-v-border bg-v-surface">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-4 py-3 text-[14px] font-semibold text-v-text">
        Notes about this analysis ({warnings.length})
      </summary>
      <ul className="space-y-1.5 border-t border-v-border px-4 py-3 text-[13.5px] text-v-text-secondary">
        {warnings.map((w, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-v-text-muted" aria-hidden />
            {w}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Whether the benchmark card has anything to show (so its section heading is not left as an empty shell). */
export function benchmarkVisible(b?: BenchmarkInfo): boolean {
  return !!b && b.status !== "unavailable" && (!!b.coverage || !!(b.profile && b.profile.length));
}

/* ---------- partial-analysis notices ---------- */

const NEUTRAL = "mb-6 flex items-start gap-3 rounded-[10px] border border-v-border bg-v-surface px-4 py-3";

/** A neutral heads-up at the top when a check or stage did not run. The details are in "Notes about this analysis". */
export function DegradedBanner() {
  return (
    <div role="note" className={NEUTRAL}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="mt-[1px] shrink-0 text-v-text-muted" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v5M12 16.5h.01" />
      </svg>
      <p className="text-sm leading-snug text-v-text-secondary">
        Some checks were unavailable for this analysis. The report below uses what could be measured; see the notes at the bottom for details.
      </p>
    </div>
  );
}

export function ExaminerUnavailable() {
  return (
    <p role="note" className="rounded-[12px] border border-v-border bg-v-surface px-4 py-3 text-[14px] leading-snug text-v-text-secondary">
      AI examiner opinion unavailable, scores use measurements only.
    </p>
  );
}

export function NoModelParagraph() {
  return (
    <p role="note" className="rounded-[12px] border border-v-border bg-v-surface px-4 py-3 text-[14px] leading-snug text-v-text-secondary">
      No model paragraph this time. A rewritten version could not be produced, so there is nothing to compare your paragraph with. The fixes above still apply.
    </p>
  );
}

export function DriftUnmeasured() {
  return (
    <p role="note" className="rounded-[12px] border border-v-border bg-v-surface px-4 py-3 text-[14px] leading-snug text-v-text-secondary">
      Topic drift could not be measured for this essay, so there is no chart to show.
    </p>
  );
}

/** Development only: the backend's stage table, from the optional debug field. Never rendered in production builds. */
export function StagesPanel({ stages }: { stages: { name: string; status: string; ms: number; note?: string }[] }) {
  return (
    <details data-testid="stages-panel" className="no-print mt-8 rounded-[12px] border border-dashed border-v-border-strong bg-v-surface">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-4 py-3 font-data text-[12px] font-bold uppercase tracking-[0.12em] text-v-text-secondary">Stages (development only)</summary>
      <div className="overflow-x-auto border-t border-v-border px-4 py-3">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="font-data text-[10.5px] uppercase tracking-[0.1em] text-v-text-muted">
              <th className="py-1 pr-3">Stage</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3 text-right">ms</th>
              <th className="py-1">Note</th>
            </tr>
          </thead>
          <tbody className="align-top text-v-text-secondary">
            {stages.map((s, i) => (
              <tr key={i} className="border-t border-v-border">
                <td className="py-1.5 pr-3 font-semibold text-v-text">{s.name}</td>
                <td className="py-1.5 pr-3">{s.status}</td>
                <td className="py-1.5 pr-3 text-right font-data">{s.ms}</td>
                <td className="break-words py-1.5">{s.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

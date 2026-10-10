"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { highlightCounts } from "@/lib/derive";
import { sliceRef } from "@/lib/client/excerpts";
import { STAGE_LABEL, similarityText, spanStatus } from "@/lib/client/status";
import { spanKey, type PassageRef, type SpanTrace, type SpanKey, type TranscriptionInfo } from "@/lib/types.extras";
import type { Paragraph, Tone } from "@/lib/types";

const TONES: Record<Tone, { label: string; cls: string; swatch: string; text: string }> = {
  strong: { label: "Strong", cls: "hl-strong", swatch: "border-b-2 border-v-good bg-v-good-wash", text: "text-v-good-text" },
  weak: { label: "Weak or generic", cls: "hl-weak", swatch: "border-b-2 border-dashed border-v-flag bg-v-flag-wash", text: "text-v-flag-text" },
  offtopic: { label: "Off-topic or unsupported", cls: "hl-offtopic", swatch: "border-b-2 border-dotted border-v-alert bg-v-alert-wash", text: "text-v-alert-text" },
};

/** A small marker per tone so colour is never the only signal (a tick, an exclamation mark, a cross). */
function ToneGlyph({ tone, size = 12 }: { tone: Tone; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={TONES[tone].text}>
      {tone === "strong" && <path d="M5 12.5l4.5 4.5L19 7.5" />}
      {tone === "weak" && <path d="M12 6v8M12 18.5h.01" />}
      {tone === "offtopic" && <path d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}

interface Pick {
  pid: string;
  idx: number;
}

type Mark = { start: number; end: number; kind: "flash" } | { start: number; end: number; kind: "uncertain"; guess: string };

/** Renders text[a, b) with inline marks for transient flashes and uncertain words. Plain text stays plain. */
function renderRange(text: string, a: number, b: number, marks: Mark[], keyBase: string): ReactNode[] {
  const cuts = new Set<number>([a, b]);
  for (const m of marks) for (const x of [m.start, m.end]) if (x > a && x < b) cuts.add(x);
  const points = [...cuts].sort((x, y) => x - y);
  const out: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x, y] = [points[i], points[i + 1]];
    const seg = text.slice(x, y);
    const flash = marks.some((m) => m.kind === "flash" && m.start <= x && m.end >= y);
    const unc = marks.find((m): m is Extract<Mark, { kind: "uncertain" }> => m.kind === "uncertain" && m.start <= x && m.end >= y);
    if (!flash && !unc) out.push(<Fragment key={`${keyBase}-${i}`}>{seg}</Fragment>);
    else
      out.push(
        <span
          key={`${keyBase}-${i}`}
          className={`${flash ? "flash-passage" : ""} ${unc ? "uncertain tip" : ""}`}
          {...(unc ? { tabIndex: 0, "data-tip": unc.guess ? `Hard to read. Best guess: ${unc.guess}` : "Hard to read", "aria-label": `${seg}. Hard to read${unc.guess ? `, best guess ${unc.guess}` : ""}` } : {})}
        >
          {seg}
        </span>,
      );
  }
  return out;
}

function uncertainMarks(p: Paragraph, uncertain: TranscriptionInfo["uncertain"]): Mark[] {
  const marks: Mark[] = [];
  for (const u of uncertain) {
    if (u.paragraphId !== p.id || !u.word) continue;
    let at = p.text.indexOf(u.word);
    if (at < 0) at = p.text.toLowerCase().indexOf(u.word.toLowerCase());
    if (at >= 0) marks.push({ start: at, end: at + u.word.length, kind: "uncertain", guess: u.guess });
  }
  return marks;
}

export const RULE_LEGEND: { tone: Tone; word: string; text: string }[] = [
  { tone: "offtopic", word: "Red", text: "a claim with no linked evidence, an opposing view that is never answered, or a paragraph that drifts off the topic." },
  { tone: "weak", word: "Amber", text: "evidence that is only weakly linked to its claim, or generic wording that could sit in any essay." },
  { tone: "strong", word: "Green", text: "a claim linked to specific evidence, or evidence that is specific." },
];

export function EssayView({
  paragraphs,
  trace,
  uncertain,
  flash,
  onShowLinked,
}: {
  paragraphs: Paragraph[];
  trace?: Record<SpanKey, SpanTrace>;
  uncertain?: TranscriptionInfo["uncertain"];
  /** Passages to flash for a moment (set by the argument map or the linked-passage button). */
  flash: PassageRef[];
  onShowLinked: (both: PassageRef[], target: PassageRef) => void;
}) {
  const counts = useMemo(() => highlightCounts(paragraphs), [paragraphs]);
  const [hidden, setHidden] = useState<Set<Tone>>(new Set());
  const [pick, setPick] = useState<Pick | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** The highlight that opened the sheet, so closing it can hand focus back. */
  const opener = useRef<string | null>(null);
  const closeSheet = () => {
    setSheetOpen(false);
    const id = opener.current;
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPick(null);
        closeSheet();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onlyRed = hidden.has("strong") && hidden.has("weak") && !hidden.has("offtopic");
  const picked = pick ? paragraphs.find((p) => p.id === pick.pid)?.spans[pick.idx] : undefined;
  const pickedTrace = pick && picked ? trace?.[spanKey(pick.pid, picked.start, picked.end)] : undefined;

  function toggle(t: Tone) {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  // Offer the jump only when the linked passage really exists in the essay text.
  const canJump = !!pickedTrace?.linked && sliceRef({ paragraphs }, pickedTrace.linked) !== null;
  const detail = picked && pick ? <DetailPanel span={picked} pid={pick.pid} trace={pickedTrace} canJump={canJump} onShowLinked={onShowLinked} /> : null;

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter highlights">
        {(Object.keys(TONES) as Tone[]).map((t) => {
          const off = hidden.has(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(t)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors ${off ? "border-v-border text-v-text-muted" : "border-v-border-strong text-v-text"}`}
            >
              <span className={`h-3.5 w-5 rounded-[3px] ${TONES[t].swatch}`} aria-hidden />
              {TONES[t].label}
              <span className="font-data text-[11px] text-v-text-muted">{counts[t]}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={onlyRed}
          onClick={() => setHidden(onlyRed ? new Set() : new Set<Tone>(["strong", "weak"]))}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors ${onlyRed ? "border-v-alert bg-v-alert-wash text-v-alert-text" : "border-v-border-strong text-v-text"}`}
        >
          <ToneGlyph tone="offtopic" size={12} />
          Show only red
        </button>
      </div>
      {hidden.size > 0 && <p className="no-print mb-3 text-[12.5px] text-v-text-muted">Hidden groups are dimmed, not removed.</p>}

      <dl className="mb-6 grid gap-2 rounded-[12px] border border-v-border bg-v-surface p-4 text-[13px] leading-snug text-v-text-secondary sm:grid-cols-3">
        <div className="sm:col-span-3 font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-text-muted">What the colours mean</div>
        {RULE_LEGEND.map((r) => (
          <div key={r.tone} className="flex items-start gap-2">
            <span className={`mt-[3px] inline-flex shrink-0 items-center gap-1 ${TONES[r.tone].text}`}>
              <span className={`h-3 w-4 rounded-[3px] ${TONES[r.tone].swatch}`} aria-hidden />
              <ToneGlyph tone={r.tone} size={11} />
            </span>
            <span>
              <dt className="inline font-semibold text-v-text">{r.word}: </dt>
              <dd className="inline">{r.text}</dd>
            </span>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          {paragraphs.map((p, pi) => {
            const marks: Mark[] = [...flash.filter((f) => f.paragraphId === p.id).map((f): Mark => ({ start: f.start, end: f.end, kind: "flash" })), ...uncertainMarks(p, uncertain ?? [])];
            const parts: ReactNode[] = [];
            let cursor = 0;
            p.spans.forEach((s, idx) => {
              if (s.start < cursor) return; // overlapping span: the earlier, wider one wins
              if (s.start > cursor) parts.push(...renderRange(p.text, cursor, s.start, marks, `${p.id}-t${idx}`));
              const isActive = pick?.pid === p.id && pick.idx === idx;
              const status = spanStatus(s.tone, s.reason, trace?.[spanKey(p.id, s.start, s.end)]).label;
              const open = () => {
                opener.current = `span-${p.id}-${s.start}-${s.end}`;
                setPick({ pid: p.id, idx });
                setSheetOpen(true);
              };
              parts.push(
                <span
                  key={`s${idx}`}
                  id={`span-${p.id}-${s.start}-${s.end}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${status}: ${s.reason}`}
                  aria-pressed={isActive}
                  className={`hl ${TONES[s.tone].cls} ${hidden.has(s.tone) ? "is-dim" : ""} ${isActive ? "is-active" : ""}`}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open();
                    }
                  }}
                  onMouseEnter={() => setPick({ pid: p.id, idx })}
                  onFocus={() => setPick({ pid: p.id, idx })}
                >
                  {renderRange(p.text, s.start, s.end, marks, `${p.id}-h${idx}`)}
                  <span className="hl-mark" aria-hidden>
                    <ToneGlyph tone={s.tone} size={11} />
                  </span>
                </span>,
              );
              cursor = s.end;
            });
            if (cursor < p.text.length) parts.push(...renderRange(p.text, cursor, p.text.length, marks, `${p.id}-end`));
            return (
              <div key={p.id} id={p.id} className="flex scroll-mt-24 gap-4">
                <span className="w-7 shrink-0 pt-[7px] font-data text-[11px] font-bold tracking-[0.1em] text-v-accent-text">P{pi + 1}</span>
                <p className="max-w-[68ch] text-[17px] leading-[1.8] text-v-text">{parts}</p>
              </div>
            );
          })}
        </div>

        {/* desktop: sticky panel */}
        <aside className="no-print hidden lg:block" aria-live="polite" aria-label="Why this passage was marked">
          <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-auto rounded-[10px] border border-v-border bg-v-card p-4" style={{ boxShadow: "var(--v-elev-3)" }}>
            {detail ?? <p className="text-[13.5px] leading-snug text-v-text-muted">Hover, focus or tap a highlighted passage to see what was found and how.</p>}
          </div>
        </aside>
      </div>

      {/* phone: bottom sheet */}
      {sheetOpen && detail && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 lg:hidden" role="dialog" aria-label="Why this passage was marked">
          <button type="button" aria-label="Close" onClick={closeSheet} className="fixed inset-0 -z-10 bg-black/30" />
          <div className="v-sheet max-h-[75dvh] overflow-auto rounded-t-[18px] border border-v-border bg-v-card p-5 pb-8" style={{ boxShadow: "var(--v-elev-3)" }}>
            {detail}
            <button type="button" onClick={closeSheet} className="mt-4 min-h-[44px] w-full rounded-full border border-v-border-strong text-sm font-semibold text-v-text">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailPanel({
  span,
  pid,
  trace,
  canJump,
  onShowLinked,
}: {
  span: Paragraph["spans"][number];
  pid: string;
  trace?: SpanTrace;
  canJump: boolean;
  onShowLinked: (both: PassageRef[], target: PassageRef) => void;
}) {
  const status = spanStatus(span.tone, span.reason, trace).label;
  const sim = trace ? similarityText(trace) : null;
  return (
    <div>
      <p className={`flex items-center gap-2 font-data text-[11px] font-bold uppercase tracking-[0.14em] ${TONES[span.tone].text}`}>
        <ToneGlyph tone={span.tone} size={14} />
        {status}
      </p>
      <p className="mt-2 text-[14px] leading-snug text-v-text-secondary">{span.reason}</p>

      {trace && (
        <div className="mt-4 border-t border-v-border pt-3">
          <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-text-muted">How we found this</p>
          <ol className="mt-2 space-y-2">
            {trace.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-v-text-secondary">
                <span className="mt-[1px] h-[20px] w-[68px] shrink-0 whitespace-nowrap rounded-full border border-v-border-strong px-2 text-center leading-[18px] font-data text-[9.5px] font-bold uppercase tracking-[0.08em] text-v-text-secondary">{STAGE_LABEL[s.stage]}</span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          {sim && <p className="mt-2 font-data text-[12px] text-v-text-muted">{sim}</p>}
          {trace.linked && canJump && (
            <button
              type="button"
              onClick={() => onShowLinked([{ paragraphId: pid, start: span.start, end: span.end }, trace.linked!], trace.linked!)}
              className="mt-3 inline-flex min-h-[44px] items-center rounded-full border border-v-border-strong px-4 text-[13px] font-semibold text-v-text transition-colors hover:border-v-accent"
            >
              Show the linked passage
            </button>
          )}
        </div>
      )}
    </div>
  );
}

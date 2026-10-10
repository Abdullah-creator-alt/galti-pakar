"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { highlightCounts } from "@/lib/derive";
import type { Paragraph, Tone } from "@/lib/types";

const TONES: Record<Tone, { label: string; cls: string; swatch: string; text: string }> = {
  strong: { label: "Strong", cls: "hl-strong", swatch: "border-b-2 border-v-good bg-v-good-wash", text: "text-v-good-text" },
  weak: { label: "Weak or generic", cls: "hl-weak", swatch: "border-b-2 border-dashed border-v-flag bg-v-flag-wash", text: "text-v-flag-text" },
  offtopic: { label: "Off-topic or unsupported", cls: "hl-offtopic", swatch: "border-b-2 border-dotted border-v-alert bg-v-alert-wash", text: "text-v-alert-text" },
};

function ToneIcon({ tone }: { tone: Tone }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={TONES[tone].text}>
      {tone === "strong" && <path d="M5 12.5l4.5 4.5L19 7.5" />}
      {tone === "weak" && <path d="M12 7v6M12 17h.01" />}
      {tone === "offtopic" && <path d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}

interface Pick {
  pid: string;
  idx: number;
}

export function EssayView({ paragraphs }: { paragraphs: Paragraph[] }) {
  const counts = useMemo(() => highlightCounts(paragraphs), [paragraphs]);
  const [hidden, setHidden] = useState<Set<Tone>>(new Set());
  const [active, setActive] = useState<Pick | null>(null);
  const [hover, setHover] = useState<Pick | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setActive(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const shown = hover ?? active;
  const detail = shown ? paragraphs.find((p) => p.id === shown.pid)?.spans[shown.idx] : null;

  function toggle(t: Tone) {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  return (
    <div>
      <div className="no-print mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter highlights">
        {(Object.keys(TONES) as Tone[]).map((t) => {
          const off = hidden.has(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(t)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors ${
                off ? "border-v-border text-v-text-muted" : "border-v-border-strong text-v-text"
              }`}
            >
              <span className={`h-3.5 w-5 rounded-[3px] ${TONES[t].swatch}`} aria-hidden />
              {TONES[t].label}
              <span className="font-data text-[11px] text-v-text-muted">{counts[t]}</span>
            </button>
          );
        })}
      </div>
      {hidden.size > 0 && <p className="no-print mb-3 text-[12.5px] text-v-text-muted">Hidden groups are dimmed, not removed.</p>}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          {paragraphs.map((p, pi) => {
            const parts: React.ReactNode[] = [];
            let cursor = 0;
            p.spans.forEach((s, idx) => {
              if (s.start < cursor) return; // overlapping span: the earlier, wider one wins
              if (s.start > cursor) parts.push(<Fragment key={`t${idx}`}>{p.text.slice(cursor, s.start)}</Fragment>);
              const isActive = active?.pid === p.id && active.idx === idx;
              parts.push(
                <span
                  key={`s${idx}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${TONES[s.tone].label}: ${s.reason}`}
                  className={`hl ${TONES[s.tone].cls} ${hidden.has(s.tone) ? "is-dim" : ""} ${isActive ? "is-active" : ""}`}
                  onClick={() => setActive(isActive ? null : { pid: p.id, idx })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActive(isActive ? null : { pid: p.id, idx });
                    }
                  }}
                  onMouseEnter={() => setHover({ pid: p.id, idx })}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover({ pid: p.id, idx })}
                  onBlur={() => setHover(null)}
                >
                  {p.text.slice(s.start, s.end)}
                </span>,
              );
              cursor = s.end;
            });
            if (cursor < p.text.length) parts.push(<Fragment key="end">{p.text.slice(cursor)}</Fragment>);
            return (
              <div key={p.id} id={p.id} className="flex scroll-mt-24 gap-4">
                <span className="w-7 shrink-0 pt-[7px] font-data text-[11px] font-bold tracking-[0.1em] text-v-accent-text">P{pi + 1}</span>
                <p className="max-w-[68ch] text-[17px] leading-[1.8] text-v-text">{parts}</p>
              </div>
            );
          })}
        </div>

        {/* desktop: sticky reason panel */}
        <aside className="no-print hidden lg:block" aria-live="polite">
          <div className="sticky top-24 rounded-[10px] border border-v-border bg-v-card p-4" style={{ boxShadow: "var(--v-elev-3)" }}>
            {detail ? (
              <ReasonBody tone={detail.tone} reason={detail.reason} />
            ) : (
              <p className="text-[13.5px] leading-snug text-v-text-muted">Hover, focus or tap a highlighted phrase to see why it was marked.</p>
            )}
          </div>
        </aside>
      </div>

      {/* phone: bottom sheet */}
      {active && detail && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 lg:hidden" role="dialog" aria-label="Highlight reason">
          <button type="button" aria-label="Close" onClick={() => setActive(null)} className="fixed inset-0 -z-10 bg-black/30" />
          <div className="v-sheet rounded-t-[18px] border border-v-border bg-v-card p-5 pb-8" style={{ boxShadow: "var(--v-elev-3)" }}>
            <ReasonBody tone={detail.tone} reason={detail.reason} />
            <button type="button" onClick={() => setActive(null)} className="mt-4 min-h-[44px] w-full rounded-full border border-v-border-strong text-sm font-semibold text-v-text">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReasonBody({ tone, reason }: { tone: Tone; reason: string }) {
  return (
    <>
      <p className={`flex items-center gap-2 font-data text-[10.5px] font-bold uppercase tracking-[0.14em] ${TONES[tone].text}`}>
        <ToneIcon tone={tone} />
        {TONES[tone].label}
      </p>
      <p className="mt-2 text-[14px] leading-snug text-v-text-secondary">{reason}</p>
    </>
  );
}

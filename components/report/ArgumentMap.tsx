"use client";

import { useState } from "react";
import { excerptOf } from "@/lib/client/excerpts";
import { claimSummaryLine, linkChip, type LinkChip } from "@/lib/client/status";
import type { ClaimLink, ClaimMap, PassageRef } from "@/lib/types.extras";
import type { EssayReport } from "@/lib/types";

const CHIP: Record<LinkChip["tone"], string> = {
  good: "bg-v-good-wash text-v-good-text",
  flag: "bg-v-flag-wash text-v-flag-text border border-v-flag/40",
  alert: "bg-v-alert-wash text-v-alert-text",
};

function ChipIcon({ tone }: { tone: LinkChip["tone"] }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {tone === "good" && <path d="M5 12.5l4.5 4.5L19 7.5" />}
      {tone === "flag" && <path d="M12 6v8M12 18.5h.01" />}
      {tone === "alert" && <path d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}

interface Row {
  link: ClaimLink;
  claim: NonNullable<ReturnType<typeof excerptOf>>;
  evidence: ReturnType<typeof excerptOf>;
  paragraphIndex: number;
}

/** Rows are built only from text sliced out of the report. A row whose offsets do not resolve is hidden, never invented. */
function buildRows(report: EssayReport, links: ClaimLink[]): Row[] {
  const rows: Row[] = [];
  for (const link of links) {
    const claim = excerptOf(report, link.claim);
    if (!claim) continue;
    const evidence = link.evidence ? excerptOf(report, link.evidence) : null;
    if (link.evidence && !evidence) continue;
    const paragraphIndex = report.paragraphs.findIndex((p) => p.id === link.claim.paragraphId);
    rows.push({ link, claim, evidence, paragraphIndex });
  }
  return rows.sort((a, b) => a.paragraphIndex - b.paragraphIndex || a.link.claim.start - b.link.claim.start);
}

export function ArgumentMap({
  report,
  claimMap,
  onFocus,
}: {
  report: EssayReport;
  claimMap: ClaimMap;
  onFocus: (refs: PassageRef[], target: PassageRef) => void;
}) {
  const rows = buildRows(report, claimMap.links);
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (rows.length === 0) return null;

  const groups = new Map<number, Row[]>();
  for (const r of rows) groups.set(r.paragraphIndex, [...(groups.get(r.paragraphIndex) ?? []), r]);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <p className="text-[15px] font-semibold text-v-text">{claimSummaryLine(claimMap.summary)}</p>
      <p className="mt-1 text-[12.5px] text-v-text-muted">Select a row to jump to the passages in your essay.</p>
      <div className="mt-4 space-y-5">
        {[...groups.entries()].map(([pi, list]) => (
          <div key={pi}>
            <p className="mb-2 font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-accent-text">Paragraph {pi + 1}</p>
            <ul className="space-y-2">
              {list.map(({ link, claim, evidence }) => {
                const chip = linkChip(link.kind, link.strength);
                const expanded = open.has(link.id);
                const refs = [link.claim, ...(link.evidence ? [link.evidence] : [])];
                return (
                  <li key={link.id} className="rounded-[12px] border border-v-border bg-v-card">
                    <button
                      type="button"
                      onClick={() => onFocus(refs, link.claim)}
                      className="block w-full rounded-[12px] p-4 text-left transition-colors hover:bg-v-surface"
                      aria-label={`${chip.label}. ${claim.short}. ${evidence ? `Linked evidence: ${evidence.short}` : "No linked evidence."} Select to show in the essay.`}
                    >
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-data text-[10px] font-bold uppercase tracking-[0.12em] ${CHIP[chip.tone]}`}>
                        <ChipIcon tone={chip.tone} />
                        {chip.label}
                      </span>
                      <span className="mt-2 block font-data text-[10px] font-bold uppercase tracking-[0.12em] text-v-text-muted">{link.kind === "counterclaim" ? "Opposing view" : "Claim"}</span>
                      <span className="block text-[14.5px] leading-snug text-v-text">&ldquo;{expanded ? claim.full : claim.short}&rdquo;</span>
                      <span className="mt-2 flex items-start gap-2 text-[13.5px] leading-snug text-v-text-secondary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-[2px] shrink-0 text-v-text-muted" aria-hidden>
                          <path d="M12 4v16M6 14l6 6 6-6" className="lg:hidden" />
                          <path d="M4 12h16M14 6l6 6-6 6" className="hidden lg:block" />
                        </svg>
                        {evidence ? (
                          <span>
                            <span className="block font-data text-[10px] font-bold uppercase tracking-[0.12em] text-v-text-muted">{link.kind === "counterclaim" ? "Answer" : "Evidence"}</span>
                            &ldquo;{expanded ? evidence.full : evidence.short}&rdquo;
                          </span>
                        ) : (
                          <span className="italic text-v-text-muted">{link.kind === "counterclaim" ? "No answer found" : "No linked evidence"}</span>
                        )}
                      </span>
                    </button>
                    {(claim.truncated || evidence?.truncated) && (
                      <div className="border-t border-v-border px-4">
                        <button type="button" onClick={() => toggle(link.id)} aria-expanded={expanded} className="min-h-[44px] text-[13px] font-semibold text-v-accent-text underline underline-offset-4">
                          {expanded ? "Show less" : "Show full text"}
                        </button>
                      </div>
                    )}
                    {typeof link.similarity === "number" && (
                      <p className="px-4 pb-3 font-data text-[11px] text-v-text-muted">match {link.similarity.toFixed(2)}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Whether the map has at least one row that resolves to real text. */
export function argumentRowCount(report: EssayReport, claimMap?: ClaimMap): number {
  return claimMap ? buildRows(report, claimMap.links).length : 0;
}

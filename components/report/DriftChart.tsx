"use client";

import { useState } from "react";
import type { Paragraph } from "@/lib/types";

const W = 720;
const H = 280;
const PAD = { l: 40, r: 20, t: 24, b: 36 };

export function DriftChart({ paragraphs, threshold }: { paragraphs: Paragraph[]; threshold: number }) {
  const [tip, setTip] = useState<number | null>(null);
  const n = paragraphs.length;
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v: number) => PAD.t + ((100 - v) * (H - PAD.t - PAD.b)) / 100;
  const line = paragraphs.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.relevance)}`).join(" ");
  const area = `${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const drifting = paragraphs.map((p, i) => ({ p, i })).filter(({ p }) => p.relevance < threshold);

  const finding = drifting.length
    ? `Paragraph${drifting.length > 1 ? "s" : ""} ${drifting.map((d) => d.i + 1).join(" and ")} drift${drifting.length > 1 ? "" : "s"} from the topic (relevance below ${threshold}).`
    : "Every paragraph stays on the topic.";

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="min-h-[220px] w-full" role="group" aria-label="Topic relevance by paragraph">
        {[25, 50, 75].map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--v-border)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(g) + 3} textAnchor="end" className="font-data" fontSize="10" fill="var(--v-text-muted)">{g}</text>
          </g>
        ))}
        <text x={PAD.l - 8} y={y(0) + 3} textAnchor="end" className="font-data" fontSize="10" fill="var(--v-text-muted)">0</text>
        <text x={PAD.l - 8} y={y(100) + 3} textAnchor="end" className="font-data" fontSize="10" fill="var(--v-text-muted)">100</text>

        <line x1={PAD.l} x2={W - PAD.r} y1={y(threshold)} y2={y(threshold)} stroke="var(--v-text-muted)" strokeWidth="1.2" strokeDasharray="5 4" />
        <text x={W - PAD.r} y={y(threshold) - 6} textAnchor="end" className="font-data" fontSize="10" fill="var(--v-text-muted)">Drift threshold ({threshold})</text>

        <path d={area} fill="var(--v-accent-wash)" />
        <path d={line} fill="none" stroke="var(--v-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="v-draw" />

        {paragraphs.map((p, i) => (
          <text key={p.id} x={x(i)} y={H - 12} textAnchor="middle" className="font-data" fontSize="10" fill="var(--v-text-muted)">P{i + 1}</text>
        ))}

        {drifting.map(({ p, i }) => (
          <g key={`f${p.id}`}>
            <line x1={x(i)} x2={x(i)} y1={y(p.relevance)} y2={y(0)} stroke="var(--v-alert)" strokeWidth="1" opacity=".5" />
            <text x={x(i)} y={y(p.relevance) + 24} textAnchor="middle" className="font-data" fontSize="10" fontWeight="700" fill="var(--v-alert-text)">P{i + 1} drifts</text>
          </g>
        ))}

        {paragraphs.map((p, i) => {
          const bad = p.relevance < threshold;
          const label = `Paragraph ${i + 1}, relevance ${p.relevance}${bad ? ", drifts from the topic" : ""}`;
          return (
            <g
              key={p.id}
              tabIndex={0}
              role="img"
              aria-label={label}
              onMouseEnter={() => setTip(i)}
              onMouseLeave={() => setTip(null)}
              onFocus={() => setTip(i)}
              onBlur={() => setTip(null)}
              onClick={() => setTip(tip === i ? null : i)}
              className="cursor-pointer outline-none focus-visible:[&>circle:first-child]:stroke-[var(--v-accent)]"
            >
              <circle cx={x(i)} cy={y(p.relevance)} r="16" fill="transparent" stroke="transparent" strokeWidth="2" />
              {bad && <circle cx={x(i)} cy={y(p.relevance)} r="10" fill="var(--v-alert-wash)" />}
              <circle cx={x(i)} cy={y(p.relevance)} r="5" fill={bad ? "var(--v-alert)" : "var(--v-accent)"} stroke="var(--v-surface)" strokeWidth="2" />
            </g>
          );
        })}

        {tip !== null && (() => {
          const p = paragraphs[tip];
          const bad = p.relevance < threshold;
          const tx = Math.min(Math.max(x(tip) - 110, 4), W - 224);
          const ty = y(p.relevance) > 120 ? y(p.relevance) - 70 : y(p.relevance) + 18;
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width="220" height="52" rx="8" fill="var(--v-card)" stroke="var(--v-border-strong)" />
              <text x={tx + 10} y={ty + 19} className="font-data" fontSize="11" fontWeight="700" fill={bad ? "var(--v-alert-text)" : "var(--v-accent-text)"}>
                P{tip + 1} · relevance {p.relevance}
              </text>
              <text x={tx + 10} y={ty + 38} fontSize="11" fill="var(--v-text-secondary)">
                {p.summary.length > 34 ? p.summary.slice(0, 33) + "…" : p.summary}
              </text>
            </g>
          );
        })()}
      </svg>
      <p className="mt-2 text-[15px] font-semibold text-v-text">{finding}</p>
      <p className="mt-1 text-[12.5px] text-v-text-muted">Relevance is scored 0 to 100 against your topic. Alert-coloured points are below the threshold.</p>
    </div>
  );
}

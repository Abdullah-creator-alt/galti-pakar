"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DriftChart } from "@/components/report/DriftChart";
import { ArgumentMap, argumentRowCount } from "@/components/report/ArgumentMap";
import { CssSection } from "@/components/report/CssSection";
import { EssayView } from "@/components/report/EssayView";
import { BenchmarkCard, ConflictsList, DegradedBanner, DriftUnmeasured, ExaminerUnavailable, NoModelParagraph, NotSavedNote, StagesPanel, TranscriptionBanner, VerificationStrip, WarningsNote, benchmarkVisible } from "@/components/report/Extras";
import { BeforeAfter, ExaminerPanel, Fixes, Scorecard, Structure, SummaryStrip, verdictSentence } from "@/components/report/Sections";
import { BandPill, ExampleBanner, LIMITATION_TEXT, LimitationNote, Reveal, SectionRule, Eyebrow } from "@/components/ui";
import { getDebug } from "@/lib/client/debugStore";
import { driftUnmeasured, isDegraded, sameText } from "@/lib/client/status";
import type { BundleSource } from "@/lib/data";
import type { AnalysisBundle, PassageRef } from "@/lib/types.extras";

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Detail({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-v-accent-wash text-v-accent-text">{icon}</span>
      <div>
        <dt className="font-data text-[10px] font-bold uppercase tracking-[0.14em] text-v-accent-text">{label}</dt>
        <dd className="mt-0.5 text-[14px] font-semibold leading-tight text-v-text">{value}</dd>
      </div>
    </div>
  );
}

const ic = (d: string) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const FLASH_MS = 2400;

export function ReportView({ bundle, source }: { bundle: AnalysisBundle; source: BundleSource }) {
  const { report, extras } = bundle;
  const v = verdictSentence(report);
  const [flash, setFlash] = useState<PassageRef[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  /** Scrolls to a passage in the essay and flashes the given passages for a moment. */
  const focusPassages = useCallback((refs: PassageRef[], target: PassageRef) => {
    setFlash(refs);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash([]), FLASH_MS);
    const el = document.getElementById(`span-${target.paragraphId}-${target.start}-${target.end}`) ?? document.getElementById(target.paragraphId);
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, []);

  // Development only: the backend's stage table, kept in memory by /analysing?debug=1.
  const debug = process.env.NODE_ENV !== "production" ? getDebug(report.id) : undefined;
  const mapRows = argumentRowCount(report, extras?.claimMap);
  const showBenchmark = benchmarkVisible(extras?.benchmark);

  return (
    <>
      <header className="border-b border-v-border" style={{ background: "var(--v-bg-field)" }}>
        <div className="mx-auto max-w-[1120px] px-4 pb-14 pt-12 sm:px-8 lg:pt-16">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <Eyebrow>CSS essay report</Eyebrow>
              <h1 className="mt-4 text-[clamp(30px,4.2vw,50px)] font-extrabold leading-[1.08] text-v-text">{report.topic}</h1>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <BandPill band={report.verdict} label={v.range} />
                <span className="font-data text-[11px] uppercase tracking-[0.12em] text-v-text-muted">{fmt.format(new Date(report.analysedAt))}</span>
              </div>
              <p className="mt-3 text-[15px] text-v-text-secondary">{v.text}</p>
              <p className="mt-1 text-[12.5px] text-v-text-muted">AI-estimated practice scores, not official FPSC marks.</p>
            </div>
            <p className="no-print max-w-[22rem] text-[12.5px] leading-snug text-v-text-muted lg:text-right">PDF download and sharing are coming soon.</p>
          </div>
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Detail label="Word count" value={String(report.wordCount)} icon={ic("M4 6h16M4 12h16M4 18h10")} />
            <Detail label="Pages" value={String(report.pageCount)} icon={ic("M7 3h8l4 4v14H7zM15 3v4h4")} />
            <Detail label="Paragraphs" value={String(report.paragraphs.length)} icon={ic("M5 7h14M5 12h14M5 17h9")} />
            <Detail label="Analysed" value={fmt.format(new Date(report.analysedAt))} icon={ic("M5 5h14v14H5zM5 10h14")} />
          </dl>
        </div>
      </header>

      <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-10 sm:px-8">
        {report.isExample && <ExampleBanner />}
        {source === "memory" && <NotSavedNote />}
        {isDegraded(extras?.warnings) && <DegradedBanner />}
        <TranscriptionBanner info={extras?.transcription} />
        <SummaryStrip report={report} />

        <SectionRule title="Scorecard" />
        <Scorecard report={report} />

        <SectionRule title="Your essay" id="essay" />
        <Reveal>
          <EssayView paragraphs={report.paragraphs} trace={extras?.trace} uncertain={extras?.transcription?.uncertain} flash={flash} onShowLinked={focusPassages} />
        </Reveal>

        <SectionRule title="Topic drift" />
        <Reveal>{driftUnmeasured(extras?.warnings) ? <DriftUnmeasured /> : <DriftChart paragraphs={report.paragraphs} threshold={report.driftThreshold} />}</Reveal>

        {mapRows > 0 && extras?.claimMap && (
          <>
            <SectionRule title="Argument map" id="argument-map" />
            <Reveal><ArgumentMap report={report} claimMap={extras.claimMap} onFocus={focusPassages} /></Reveal>
          </>
        )}

        <SectionRule title="Structure" />
        <Reveal><Structure report={report} /></Reveal>

        {extras?.cssProfile && (
          <>
            <SectionRule title="For the CSS English Essay" id="css" />
            <Reveal><CssSection info={extras.cssProfile} /></Reveal>
          </>
        )}

        <SectionRule title="Top 3 fixes" />
        <Reveal><Fixes report={report} /></Reveal>

        <SectionRule title="Before and after" />
        <Reveal>{sameText(report.rewrite.original, report.rewrite.improved) ? <NoModelParagraph /> : <BeforeAfter report={report} rewriteExtras={extras?.rewriteExtras} />}</Reveal>

        {report.examiners.length === 0 && (
          <>
            <SectionRule title="AI examiner runs" />
            <Reveal><ExaminerUnavailable /></Reveal>
          </>
        )}
        {report.examiners.length > 0 && (
          <>
            <SectionRule title="AI examiner runs" />
            <Reveal>
              <h2 className="mb-4 text-[clamp(22px,2.6vw,30px)] font-extrabold leading-[1.15] text-v-text">
                {report.examiners.length === 1 ? "One AI run scored this" : `${report.examiners.length} AI runs scored this`}
              </h2>
              <ExaminerPanel report={report} />
              <ConflictsList conflicts={extras?.conflicts} report={report} />
            </Reveal>
          </>
        )}
        <VerificationStrip v={extras?.verification} />

        {showBenchmark && (
          <>
            <SectionRule title="Top-essay benchmark" />
            <Reveal><BenchmarkCard b={extras?.benchmark} /></Reveal>
          </>
        )}

        <div className="mt-12">
          <LimitationNote text={LIMITATION_TEXT} />
        </div>
        <WarningsNote warnings={extras?.warnings} />
        {debug && <StagesPanel stages={debug.stages} />}
        <p className="no-print mt-8 text-center">
          <Link href="/new" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-v-accent-text underline underline-offset-4">
            Analyse another CSS essay
          </Link>
        </p>
      </main>
    </>
  );
}

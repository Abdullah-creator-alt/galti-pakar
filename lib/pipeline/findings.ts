import type { EssayAnalysis } from "./analyse.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";
import { countCliches } from "./cliches.ts";
import type { MeasuredFindings } from "./findings.types.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";

/** Adapters from earlier pipeline steps to MeasuredFindings. Each returns only the fields it can fill. */

export function findingsFromAnalysis(analysis: EssayAnalysis, essay: Pick<TranscribedEssay, "paragraphs" | "wordCount">): Pick<MeasuredFindings, "drift" | "genericness" | "rules"> {
  return {
    drift: analysis.paragraphs.map((p) => ({ paragraphId: p.id, relevance: p.relevance, drifts: p.driftFlag })),
    genericness: analysis.paragraphs.map((p) => {
      const count = (level: string) => p.sentences.filter((s) => s.level === level).length;
      return { paragraphId: p.id, avgGenericScore: p.avgGenericScore, generic: count("generic"), mixed: count("mixed"), specific: count("specific"), unassessed: count("unassessed") };
    }),
    rules: {
      wordCount: essay.wordCount,
      paragraphCount: essay.paragraphs.length,
      clicheHits: essay.paragraphs.reduce((n, p) => n + countCliches(p.text), 0),
      missingIntro: !essay.paragraphs.some((p) => p.kind === "intro"),
      missingConclusion: !essay.paragraphs.some((p) => p.kind === "conclusion"),
    },
  };
}

export function findingsFromBenchmark(r: BenchmarkResult): Pick<MeasuredFindings, "benchmark"> {
  return {
    benchmark: {
      missingPoints: r.coverage?.missing.map((m) => m.point) ?? [],
      profileGaps: r.profile.filter((p) => p.position !== "within").map((p) => `${p.label}: ${p.position} the reference range`),
    },
  };
}

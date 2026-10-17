/**
 * Types for the specialized argument-span classifier and its integration adapter.
 */

import type { ArgumentRole, SentenceNode } from "../types.ts";

export type ClassifierRole = "thesis" | "claim" | "counterclaim" | "rebuttal" | "conclusion" | "evidence";

export interface ClassifierPredictedSpan {
  start: number;
  end: number;
  label: string; // e.g. "Position", "Claim", "Evidence"
  confidence?: number;
}

export interface SentenceCandidate {
  sentenceId: string;
  role: ClassifierRole;
  confidence: number;
  coverage: number;
}

export interface ClassifierOutput {
  name: string;
  spans: ClassifierPredictedSpan[];
  candidates: SentenceCandidate[];
}

export type ClassifyFn = (text: string, sentences: SentenceNode[]) => Promise<ClassifierOutput | null>;

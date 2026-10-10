import { checkModelFeatures, type GenericnessModel } from "./genericness.ts";
// The runtime data files are imported statically, so the bundler copies them into the serverless function and a missing
// file fails the build instead of failing a request. (Reading them with fs at run time is invisible to Next's file
// tracing and would ship the whole data/ folder, caches included.) The attribute also lets Node run this file directly.
import topicsJson from "../../data/topics.embedded.json" with { type: "json" };
import bankJson from "../../data/generic-bank.embedded.json" with { type: "json" };
import modelJson from "../../data/genericness-model.json" with { type: "json" };

export interface TopicItem {
  id: string;
  theme: string;
  text: string;
}
export interface EmbeddedTopic extends TopicItem {
  vec: number[];
}

export interface Assets {
  topics: EmbeddedTopic[];
  bankVecs: number[][];
  model: GenericnessModel;
}

/** The raw bundled files, for the health check. */
export const RAW_ASSETS = { topics: topicsJson as unknown as { topics: EmbeddedTopic[] }, bank: bankJson as unknown as { items: { text: string; vec: number[] }[] }, model: modelJson as unknown as GenericnessModel };

let cached: Assets | null = null;

/** Loads runtime assets once per server instance (module scope, so warm invocations are instant). Throws a clear error if the data is unusable. */
export function loadAssets(): Assets {
  if (cached) return cached;
  const { topics } = RAW_ASSETS.topics;
  const bank = RAW_ASSETS.bank.items;
  const model = RAW_ASSETS.model;
  checkModelFeatures(model);
  if (!topics?.length || !bank?.length) throw new Error("data/topics.embedded.json or data/generic-bank.embedded.json is empty. Run: npm run build:data");
  cached = { topics, bankVecs: bank.map((b) => b.vec), model };
  return cached;
}

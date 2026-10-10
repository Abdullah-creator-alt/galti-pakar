import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkModelFeatures, type GenericnessModel } from "./genericness.ts";

export const DATA_DIR = path.join(process.cwd(), "data");

export interface TopicItem {
  id: string;
  theme: string;
  text: string;
}
export interface EmbeddedTopic extends TopicItem {
  vec: number[];
}

function readJson<T>(file: string, fix: string): T {
  const p = path.join(DATA_DIR, file);
  if (!existsSync(p)) throw new Error(`Missing data file data/${file}. ${fix}`);
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch (e) {
    throw new Error(`Could not parse data/${file}: ${(e as Error).message}. ${fix}`);
  }
}

export interface Assets {
  topics: EmbeddedTopic[];
  bankVecs: number[][];
  model: GenericnessModel;
}

let cached: Assets | null = null;

/** Loads runtime assets once per server instance. Throws a clear error if anything is missing. */
export function loadAssets(): Assets {
  if (cached) return cached;
  const build = "Run: npm run build:data";
  const topics = readJson<{ topics: EmbeddedTopic[] }>("topics.embedded.json", build).topics;
  const bank = readJson<{ items: { text: string; vec: number[] }[] }>("generic-bank.embedded.json", build).items;
  const model = readJson<GenericnessModel>("genericness-model.json", "Run: npm run train:genericness");
  checkModelFeatures(model);
  if (!topics.length || !bank.length) throw new Error("data/topics.embedded.json or data/generic-bank.embedded.json is empty. Run: npm run build:data");
  cached = { topics, bankVecs: bank.map((b) => b.vec), model };
  return cached;
}

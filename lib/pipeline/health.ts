import { loadBenchmark } from "./benchmark.ts";
import { RAW_ASSETS } from "./dataFiles.ts";
import { checkModelFeatures } from "./genericness.ts";

function ok(f: () => boolean): boolean {
  try {
    return f();
  } catch {
    return false;
  }
}

/**
 * Whether each data file the pipeline needs is present in this deployment and usable. The files are bundled at build
 * time, so this reports what the running function actually holds. No secrets, no contents.
 */
export function assetStatus(): Record<string, boolean> {
  return {
    topicsEmbedded: ok(() => Array.isArray(RAW_ASSETS.topics.topics) && RAW_ASSETS.topics.topics.length > 0 && RAW_ASSETS.topics.topics[0].vec.length > 0),
    genericBank: ok(() => Array.isArray(RAW_ASSETS.bank.items) && RAW_ASSETS.bank.items.length > 0),
    genericnessModel: ok(() => {
      checkModelFeatures(RAW_ASSETS.model);
      return Array.isArray(RAW_ASSETS.model.weights) && RAW_ASSETS.model.weights.length > 0;
    }),
    benchmark: ok(() => loadBenchmark().themes.length > 0),
  };
}

/** Assets without which the analysis cannot run. */
export const REQUIRED_ASSETS = ["topicsEmbedded", "genericBank", "genericnessModel", "benchmark"] as const;

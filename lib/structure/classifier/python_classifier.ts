// Python classifier bridge for hybrid integration
// This file provides a ClassifyFn implementation that delegates to a Python script.
// The script `infer.py` lives in the training workspace and returns a JSON payload
// matching `ClassifierOutput`. For now it returns an empty result (no candidates),
// which allows the system to run in hybrid mode without breaking existing behavior.

import { spawn } from "child_process";
import type { ClassifyFn, ClassifierOutput } from "./types.ts";

/**
 * Bridge to the Python inference script.
 *
 * The bridge sends a JSON payload containing the essay text and an array of
 * sentence objects (with id, start, end) to the Python process via stdin and
 * expects a JSON object on stdout that conforms to {@link ClassifierOutput}.
 *
 * Errors or a missing classifier simply resolve to `null`, which the analysis
 * pipeline treats as “classifier unavailable”.
 */
export const pythonClassify: ClassifyFn = async (text, sentences) => {
  return new Promise<ClassifierOutput | null>((resolve) => {
    // Resolve the path relative to the repository root.
    const scriptPath =
      "../training/persuade/persuade_train/infer.py"; // relative to lib/structure/classifier
    const python = spawn("python3", [scriptPath]);

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    python.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    python.on("close", (code) => {
      if (code !== 0) {
        console.error(`Python classifier exited with code ${code}: ${stderr}`);
        resolve(null);
        return;
      }
      try {
        const result: ClassifierOutput = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        console.error("Failed to parse classifier output", e, stdout);
        resolve(null);
      }
    });

    // Send request payload.
    const payload = JSON.stringify({ text, sentences });
    python.stdin.write(payload);
    python.stdin.end();
  });
};

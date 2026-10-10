import { mockReport } from "../mock.ts";
import type { EssayReport } from "../types.ts";
import { parseReport } from "./schema.ts";

/** Placeholder pipeline result: the example report with the topic and page count replaced. Stays flagged isExample. */
export function buildMockReport(topic: string, pageCount: number): EssayReport {
  return parseReport({
    ...mockReport,
    id: `mock-${Date.now().toString(36)}`,
    topic,
    pageCount,
    analysedAt: new Date().toISOString(),
    isExample: true,
  });
}

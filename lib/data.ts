import { mockHistory, mockReport } from "./mock.ts";
import type { EssayReport, HistoryItem } from "./types.ts";

/**
 * Single data-access point. Replace the bodies with real API calls later;
 * no component imports the mock directly.
 */
export async function getReport(id: string): Promise<EssayReport | null> {
  return { ...mockReport, id };
}

export async function getHistory(): Promise<HistoryItem[]> {
  return mockHistory;
}

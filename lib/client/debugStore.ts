/**
 * Development-only: keeps the backend's optional "debug" field in memory so the report page can show the stage table.
 * It is never written to storage, and nothing here runs in production builds (callers check NODE_ENV).
 */
import type { DebugInfo } from "./status.ts";

const store = new Map<string, DebugInfo>();

export const setDebug = (reportId: string, info: DebugInfo): void => void store.set(reportId, info);
export const getDebug = (reportId: string): DebugInfo | undefined => store.get(reportId);
export const clearDebug = (): void => store.clear();

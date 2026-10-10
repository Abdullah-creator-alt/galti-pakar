/**
 * Server-only Gemini REST client. The key is read from GEMINI_API_KEY and never
 * leaves the server: do not import this file from components or client code.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { EMBEDDING_DIMENSIONS, GEMINI_API_BASE } from "./config.ts";

if (typeof window !== "undefined") {
  throw new Error("lib/gemini.ts is server-only and must not be imported in client code.");
}

/** What one analysis actually cost, per model: calls made (including failed ones) and tokens Gemini reported. */
export interface ModelUsage {
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  embeddedTexts: number;
}
export type UsageReport = Record<string, ModelUsage>;

const usageStore = new AsyncLocalStorage<UsageReport>();

function record(model: string, add: Partial<ModelUsage>) {
  const u = usageStore.getStore();
  if (!u) return;
  const m = (u[model] ??= { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, embeddedTexts: 0 });
  for (const [k, v] of Object.entries(add) as [keyof ModelUsage, number][]) m[k] += v;
}

/**
 * Runs fn and hands every Gemini call made inside it to onUsage, whether fn succeeds or throws. Request-scoped:
 * concurrent requests do not mix.
 */
export async function withUsage<T>(fn: () => Promise<T>, onUsage: (u: UsageReport) => void): Promise<T> {
  const usage: UsageReport = {};
  try {
    return await usageStore.run(usage, fn);
  } finally {
    onUsage(usage);
  }
}

/** Sums a usage report into one line for logs and the debug view. */
export function usageTotals(u: UsageReport) {
  const t = { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, embeddedTexts: 0 };
  for (const m of Object.values(u)) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += m[k];
  return t;
}

export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.");
  return key;
}

async function call<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`${GEMINI_API_BASE}/${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey(), ...init?.headers },
    });
  } catch (e) {
    if (controller.signal.aborted) throw new GeminiError(`Gemini did not respond within ${Math.round((timeoutMs ?? 0) / 1000)} seconds.`, 504);
    throw new GeminiError(`Could not reach Gemini: ${(e as Error).message}`, 502);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new GeminiError(`Gemini ${res.status}: ${msg}`, res.status);
  }
  return body as T;
}

export interface ModelInfo {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

export async function listModels(): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  let token = "";
  do {
    const r = await call<{ models?: ModelInfo[]; nextPageToken?: string }>(`models?pageSize=200${token ? `&pageToken=${token}` : ""}`);
    out.push(...(r.models ?? []));
    token = r.nextPageToken ?? "";
  } while (token);
  return out;
}

export interface InlineImage {
  mimeType: string;
  /** base64, no data: prefix */
  data: string;
}

export interface GenerateOptions {
  model: string;
  prompt: string;
  images?: InlineImage[];
  system?: string;
  /** Request JSON output. Pass a Gemini-style responseSchema to constrain it. */
  json?: boolean;
  responseSchema?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  /** 0 turns thinking off on 2.5 flash models; omit for the model default. */
  thinkingBudget?: number;
  /** Abort the request after this many milliseconds. */
  timeoutMs?: number;
}

export async function generateText(opts: GenerateOptions): Promise<string> {
  const parts: unknown[] = [{ text: opts.prompt }];
  for (const img of opts.images ?? []) parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  type Reply = {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  let r: Reply;
  try {
    r = await call<Reply>(`models/${opts.model}:generateContent`, {
      method: "POST",
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
        generationConfig: {
          temperature: opts.temperature ?? 0.2,
          ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
          ...(opts.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } } : {}),
          ...(opts.json || opts.responseSchema ? { responseMimeType: "application/json" } : {}),
          ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
        },
      }),
    }, opts.timeoutMs);
  } catch (e) {
    record(opts.model, { calls: 1, failed: 1 });
    throw e;
  }
  const um = r.usageMetadata ?? {};
  record(opts.model, { calls: 1, inputTokens: um.promptTokenCount ?? 0, outputTokens: um.candidatesTokenCount ?? 0, thinkingTokens: um.thoughtsTokenCount ?? 0 });
  const text = r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new GeminiError(`Gemini returned no text (${r.promptFeedback?.blockReason ?? r.candidates?.[0]?.finishReason ?? "unknown reason"}).`);
  return text;
}

export async function generateJson<T = unknown>(opts: GenerateOptions): Promise<T> {
  const text = await generateText({ ...opts, json: true });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError("Gemini returned JSON that could not be parsed.");
  }
}

export type EmbedTaskType = "SEMANTIC_SIMILARITY" | "CLASSIFICATION" | "CLUSTERING" | "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/** Max requests per batchEmbedContents call. */
export const EMBED_BATCH_LIMIT = 100;

export async function embed(
  model: string,
  texts: string[],
  dimensions = EMBEDDING_DIMENSIONS,
  taskType?: EmbedTaskType,
  timeoutMs?: number,
): Promise<number[][]> {
  let r: { embeddings?: { values: number[] }[] };
  try {
    r = await call<{ embeddings?: { values: number[] }[] }>(`models/${model}:batchEmbedContents`, {
      method: "POST",
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: `models/${model}`,
          content: { parts: [{ text: t }] },
          outputDimensionality: dimensions,
          ...(taskType ? { taskType } : {}),
        })),
      }),
    }, timeoutMs);
  } catch (e) {
    record(model, { calls: 1, failed: 1 });
    throw e;
  }
  // The batch endpoint reports no token counts, so the number of texts embedded is the honest unit here.
  record(model, { calls: 1, embeddedTexts: texts.length });
  return (r.embeddings ?? []).map((e) => e.values);
}

import { NextResponse } from "next/server";
import { PIPELINE } from "@/lib/config";
import { MODEL_NAMES, PipelineFailure, runPipeline, toApiError, type StageRecord } from "@/lib/pipeline/orchestrate";
import { ApiError, validateUpload } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const maxDuration = 120;

const TOO_LARGE = "These photos are too large to send together. Please use fewer pages or retake them at a lower resolution.";

function fail(status: number, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { message } }, { status, headers });
}

/** One structured log line per request: stage names, statuses and timings, sizes and model names. Never the key, images or essay text. */
function log(entry: { ok: boolean; status: number; pages?: number; words?: number; ms: number; stages: StageRecord[] }) {
  console.log(JSON.stringify({ event: "analyze", ...entry, stages: entry.stages.map((s) => ({ n: s.name, s: s.status, ms: s.ms })), models: MODEL_NAMES }));
}

export async function POST(req: Request) {
  const started = Date.now();
  let pages: number | undefined;
  try {
    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data"))
      throw new ApiError(415, "Send the essay as a multipart form with a topic and one or more images.");
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > PIPELINE.MAX_BODY_BYTES) throw new ApiError(413, TOO_LARGE);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "We could not read that upload. Try again with fewer or smaller photos.");
    }
    const { topic, files } = validateUpload(form);
    pages = files.length;
    if (files.reduce((n, f) => n + f.size, 0) > PIPELINE.MAX_BODY_BYTES) throw new ApiError(413, TOO_LARGE);

    const images = await Promise.all(files.map(async (f) => ({ data: new Uint8Array(await f.arrayBuffer()), name: f.name })));
    const out = await runPipeline({ images, topic }, { signal: req.signal });

    log({ ok: true, status: 200, pages, words: out.report.wordCount, ms: Date.now() - started, stages: out.stages });
    const debug = req.headers.get("x-debug") === "1" && process.env.ALLOW_DEBUG === "true";
    return NextResponse.json({ report: out.report, extras: out.extras, ...(debug ? { debug: { stages: out.stages, meta: out.meta } } : {}) });
  } catch (e) {
    const api = e instanceof PipelineFailure || e instanceof ApiError ? e : toApiError(e);
    log({ ok: false, status: api.status, pages, ms: Date.now() - started, stages: e instanceof PipelineFailure ? e.stages : [] });
    // A busy AI service is temporary: tell the client when to come back.
    return fail(api.status, api.message, api.status === 503 ? { "Retry-After": "60" } : undefined);
  }
}

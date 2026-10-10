import { NextResponse } from "next/server";
import { buildMockReport } from "@/lib/pipeline/mock";
import { ApiError, validateUpload } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(req: Request) {
  try {
    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data"))
      throw new ApiError(415, "Send the essay as a multipart form with a topic and one or more images.");

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "We could not read that upload. Try again with fewer or smaller photos.");
    }
    const { topic, files } = validateUpload(form);

    // TODO: replace with the real pipeline: readHandwriting -> labelStructure
    // -> (analyseGenericnessAndDrift || scoreExaminers) -> suggestFixes -> merge.
    const report = buildMockReport(topic, files.length);
    return NextResponse.json(report);
  } catch (e) {
    if (e instanceof ApiError) return fail(e.status, e.message);
    console.error("analyze failed", e);
    return fail(500, "Something went wrong while analysing your essay. Your photos were not lost; please try again.");
  }
}

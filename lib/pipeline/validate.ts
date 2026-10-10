import { UPLOAD_LIMITS } from "../config.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ValidatedUpload {
  topic: string;
  files: File[];
}

/** Validates a multipart upload. Throws ApiError with a user-readable message. */
export function validateUpload(form: FormData): ValidatedUpload {
  const L = UPLOAD_LIMITS;
  const topic = String(form.get("topic") ?? "").trim();
  if (topic.length < L.minTopicChars) throw new ApiError(400, "Add the essay topic before analysing.");
  if (topic.length > L.maxTopicChars) throw new ApiError(400, `The topic is too long. Keep it under ${L.maxTopicChars} characters.`);

  const files = form.getAll("images").filter((v): v is File => typeof v !== "string" && v.size >= 0);
  if (files.length < L.minPages) throw new ApiError(400, "Add at least one photo of your essay.");
  if (files.length > L.maxPages) throw new ApiError(400, `You can add up to ${L.maxPages} pages. Remove ${files.length - L.maxPages} and try again.`);

  for (const f of files) {
    if (!(L.mimeTypes as readonly string[]).includes(f.type))
      throw new ApiError(415, `"${f.name}" is not a supported image. Use a JPEG, PNG, WebP or HEIC photo.`);
    if (f.size === 0) throw new ApiError(400, `"${f.name}" is empty. Retake the photo.`);
    if (f.size > L.maxBytes)
      throw new ApiError(413, `"${f.name}" is larger than ${L.maxBytes / 1024 / 1024} MB. Retake it at a lower resolution.`);
  }
  return { topic, files };
}

import { importResume, MAX_RESUME_BYTES, UserFacingError } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { withUser } from "@/server/http";
import { getAi, getFileStorage } from "@/server/services";

export const runtime = "nodejs";
// Parsing waits on the AI call, which can take up to a minute with retries.
export const maxDuration = 120;

/**
 * POST /api/resume/import (multipart, field "file"): stores the resume, reads it, and returns a
 * draft profile for the student to confirm. Nothing is written to the profile here.
 */
export const POST = withUser(async ({ request, db }) => {
  // Browsers always send Content-Length for a file upload. Without one the body would be read in
  // full before its size could be checked, so it is refused up front.
  const lengthHeader = request.headers.get("content-length");
  const declared = lengthHeader === null ? NaN : Number(lengthHeader);
  if (!Number.isFinite(declared) || declared < 0) {
    throw new UserFacingError("LENGTH_REQUIRED", "The upload didn't come through. Please try again.", 411);
  }
  if (declared > MAX_RESUME_BYTES + 64 * 1024) {
    throw new UserFacingError("FILE_TOO_LARGE", "That file is bigger than 5 MB. Save a smaller PDF or Word file and try again.", 413);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    throw new UserFacingError("UPLOAD_FAILED", "The upload didn't come through. Please try again.");
  }
  if (!(file instanceof File)) {
    throw new UserFacingError("NO_FILE", "Choose your resume file first.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await importResume({ db, storage: getFileStorage(), ai: getAi() }, bytes);
  return NextResponse.json(result);
});

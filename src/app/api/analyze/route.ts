import { NextResponse } from "next/server";

import { isAiUsable, loadAiConfig } from "@/lib/ai/config";
import { sharedAiUsedToday, studentDailyLimit } from "@/lib/ai/daily-limit";
import { AiError } from "@/lib/ai/errors";
import { analyzeResumeJob } from "@/lib/jobs/analyze-resume";
import { startJob } from "@/lib/jobs/runner";
import { RESUME_MAX_BYTES, RESUME_MESSAGES, resumeText } from "@/lib/resume-text";
import { route } from "@/lib/route";

/**
 * Pathfinder: starts a resume analysis from a file sent as the request body. Its text is read
 * here, then a job reads it into a profile and reviews it. The file's name comes in the
 * x-file-name header. A route handler, since Server Actions take at most 1 MB.
 */
export const POST = route(async (request) => {
  if (Number(request.headers.get("content-length") ?? 0) > RESUME_MAX_BYTES) {
    return NextResponse.json({ error: RESUME_MESSAGES.tooBig }, { status: 413 });
  }
  if (!(await isAiUsable())) {
    return NextResponse.json({ error: "Resume analysis isn't available on this server yet. Please try again later." }, { status: 503 });
  }
  // Say so now rather than halfway through, when today's shared AI limit is already used.
  const limit = await studentDailyLimit();
  if (limit !== null && (await loadAiConfig()).sharedKey && (await sharedAiUsedToday()) >= limit) {
    return NextResponse.json({ error: AiError.of("daily-limit").message }, { status: 429 });
  }
  const read = await resumeText(new Uint8Array(await request.arrayBuffer()));
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
  const fileName = fileNameFrom(request.headers.get("x-file-name"));
  const jobId = await startJob(analyzeResumeJob, { resume: read.text, fileName });
  return NextResponse.json({ jobId });
});

/** The uploaded file's name, decoded and kept short; empty when missing or unreadable. */
function fileNameFrom(header: string | null): string {
  if (!header) return "";
  try {
    return decodeURIComponent(header).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
  } catch {
    return "";
  }
}

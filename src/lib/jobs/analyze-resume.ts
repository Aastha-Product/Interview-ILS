import "server-only";

import { z } from "zod";

import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { extractProfile, reviewResume } from "@/lib/ai/tasks";
import { fillProfileIfEmpty, saveResumeAnalysis } from "@/lib/resume-analysis";
import { ANALYSIS_STEPS } from "@/lib/resume-analysis-steps";
import { MAX_RESUME_CHARACTERS } from "@/lib/resume-text";

import { defineJob } from "./runner";

/**
 * Pathfinder: the whole analysis after an upload, with nothing to choose. Reads the resume into a
 * profile, reviews it, fills the profile from it when the profile is still empty, and keeps the
 * results. Each step is reported as it starts, so the progress shows the real work.
 */
export const analyzeResumeJob = defineJob({
  type: "analyze-resume",
  input: z.object({ resume: z.string().trim().min(1).max(MAX_RESUME_CHARACTERS), fileName: z.string().max(255).default("") }),
  result: z.object({ analysisId: z.string() }),
  async run({ resume, fileName }, { step, signal }) {
    await step(ANALYSIS_STEPS[1]);
    const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
    const read = await extractProfile(provider, { resume }, { ...options, signal });

    await step(ANALYSIS_STEPS[2]);
    const review = await reviewResume(provider, { resume, profile: read.data }, { ...options, signal });

    await step(ANALYSIS_STEPS[3]);
    signal.throwIfAborted();
    // The first resume fills an empty profile, so the job tools work straight away; a later one
    // never overwrites what the student has written. Several at once: only the first fills it (QA M-1).
    const profileFilled = await fillProfileIfEmpty(read.data);
    const analysisId = await saveResumeAnalysis({
      fileName,
      profile: read.data,
      review: review.data,
      readWith: `${read.promptVersion} ${review.promptVersion}`,
      profileFilled,
    });
    return { analysisId };
  },
});

export type AnalyzeResumeResult = z.infer<typeof analyzeResumeJob.result>;

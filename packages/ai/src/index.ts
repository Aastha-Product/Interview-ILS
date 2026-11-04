import { createAiClient, type AiClient } from "./client";
import { createGeminiProvider } from "./providers/gemini";
import { createMockProvider } from "./providers/mock";

export { createAiClient, hashInput, toModelJsonSchema } from "./client";
export type { AiClient, AiClientOptions, RunContext } from "./client";
export { AiError } from "./errors";
export { createGeminiProvider } from "./providers/gemini";
export { createMockProvider } from "./providers/mock";
export { resumeParseTask, resumeDraftSchema } from "./tasks/resume-parse";
export type { ResumeDraft } from "./tasks/resume-parse";
export { heuristicResumeParse } from "./tasks/resume-heuristic";
export { wrapUntrusted, UNTRUSTED_DATA_RULES } from "./untrusted";
export { canonicalSkill, findSkillsInText, isKnownSkill } from "./skills";
export {
  jobExtractTask,
  jobRequirementsSchema,
  heuristicJobExtract,
  WORK_MODES,
  SENIORITIES,
} from "./tasks/job-extract";
export type { JobRequirements, JobExtractInput } from "./tasks/job-extract";
export { matchExplainTask, matchExplanationSchema, validateGaps, templateExplanation } from "./tasks/match-explain";
export type { MatchExplanation, MatchExplainInput } from "./tasks/match-explain";
export type { AiProvider, AiRecorder, AiRunRecord, AiOutcome, TaskDefinition } from "./types";

export interface AiEnv {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

/** Gemini when a key is configured, otherwise the keyless mock. */
export function createAiClientFromEnv(env: AiEnv): AiClient {
  const provider = env.GEMINI_API_KEY
    ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-flash-latest" })
    : createMockProvider();
  return createAiClient({ provider });
}

import { createAiClient, type AiClient } from "./client";
import { createGeminiProvider } from "./providers/gemini";
import { createMockProvider } from "./providers/mock";
import { createOpenAiCompatibleProvider } from "./providers/openai-compatible";

export { createAiClient, DEFAULT_BREAKER, hashInput, toModelJsonSchema, withDeadline } from "./client";
export type { AiClient, AiClientOptions, CircuitBreakerOptions, RunContext } from "./client";
export { createOpenAiCompatibleProvider } from "./providers/openai-compatible";
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
// Drafting track
export {
  resumeTailorTask,
  resumeTailorSchema,
  heuristicTailor,
  MAX_BULLETS_PER_ITEM,
} from "./tasks/resume-tailor";
export type {
  ResumeTailorInput,
  ResumeTailorOutput,
  DraftingJob,
  DraftingRequirements,
} from "./tasks/resume-tailor";
export {
  answersDraftTask,
  answersDraftSchema,
  heuristicAnswers,
  DEFAULT_QUESTIONS,
  roleQuestions,
  NEEDS_STUDENT,
} from "./tasks/answers-draft";
export type { AnswersDraftInput, AnswersDraftOutput } from "./tasks/answers-draft";
export { factVerifyTask, factVerifySchema, heuristicVerify, MOCK_SUPPORT_THRESHOLD } from "./tasks/fact-verify";
export type { FactVerifyInput, FactVerifyOutput } from "./tasks/fact-verify";
export { contentWords, supportRatio, stem, tidyBullet } from "./tasks/drafting-text";
export type { PromptFact } from "./tasks/drafting-text";

export interface AiEnv {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  FALLBACK_AI_BASE_URL?: string;
  FALLBACK_AI_API_KEY?: string;
  FALLBACK_AI_MODEL?: string;
}

/**
 * Gemini when a key is configured, otherwise the keyless mock. The OpenAI-compatible fallback is
 * attached only when all three FALLBACK_AI_* values are set (config refuses a partial set).
 */
export function createAiClientFromEnv(env: AiEnv): AiClient {
  const provider = env.GEMINI_API_KEY
    ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-flash-latest" })
    : createMockProvider();
  const fallback =
    env.FALLBACK_AI_BASE_URL && env.FALLBACK_AI_API_KEY && env.FALLBACK_AI_MODEL
      ? createOpenAiCompatibleProvider({
          baseUrl: env.FALLBACK_AI_BASE_URL,
          apiKey: env.FALLBACK_AI_API_KEY,
          model: env.FALLBACK_AI_MODEL,
        })
      : undefined;
  return createAiClient({ provider, fallback });
}

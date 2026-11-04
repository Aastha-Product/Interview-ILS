import type { z } from "zod";

export interface ProviderRequest {
  task: string;
  system: string;
  user: string;
  /** JSON Schema the model must follow. */
  jsonSchema: Record<string, unknown>;
  signal: AbortSignal;
  /** Only the mock provider uses this: produces the task's canned output. */
  mock: () => unknown;
}

export interface ProviderResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  readonly name: string;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

/** One AI task: a versioned prompt, the shape of its answer, and a mock answer for keyless dev. */
export interface TaskDefinition<Input, Output> {
  name: string;
  /** Bump when the prompt changes, so results can be compared across versions. */
  promptVersion: string;
  outputSchema: z.ZodType<Output>;
  buildPrompt(input: Input): { system: string; user: string };
  mock(input: Input): Output;
  timeoutMs?: number;
}

/** What gets stored per model call. Never the prompt or the answer, only sizes and a hash. */
export interface AiRunRecord {
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  outcome: AiOutcome;
  inputHash: string;
}

export type AiOutcome =
  | "ok"
  | "timeout"
  | "rate_limited"
  | "server_error"
  | "invalid_output"
  | "bad_request"
  | "network_error";

export interface AiRecorder {
  record(run: AiRunRecord): Promise<void>;
}

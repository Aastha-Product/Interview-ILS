import { createHash } from "node:crypto";
import { z } from "zod";
import { AiError, classifyError } from "./errors";
import type { AiOutcome, AiProvider, AiRecorder, TaskDefinition } from "./types";

export interface AiClientOptions {
  provider: AiProvider;
  /** Default per-call timeout. */
  timeoutMs?: number;
  /** Total attempts including the first one. */
  maxAttempts?: number;
  /** Backoff before attempt 2, 3, ... (jitter is added). */
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export interface RunContext {
  recorder?: AiRecorder;
}

export interface AiClient {
  readonly providerName: string;
  run<I, O>(task: TaskDefinition<I, O>, input: I, context?: RunContext): Promise<O>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Converts a Zod schema to the JSON Schema sent to the model. */
export function toModelJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function hashInput(system: string, user: string): string {
  return createHash("sha256").update(system).update("\n\u0000\n").update(user).digest("hex");
}

/**
 * The single entry point for model calls: timeout, retries with backoff and jitter, Zod
 * validation, and a usage record per attempt. Circuit breaker and fallback model come in Phase 4.
 */
export function createAiClient(options: AiClientOptions): AiClient {
  const {
    provider,
    timeoutMs = 60_000,
    maxAttempts = 3,
    backoffMs = [1_000, 2_000, 4_000],
    sleep = defaultSleep,
    random = Math.random,
    now = Date.now,
  } = options;

  return {
    providerName: provider.name,
    async run(task, input, context = {}) {
      const { system, user } = task.buildPrompt(input);
      const jsonSchema = toModelJsonSchema(task.outputSchema);
      const inputHash = hashInput(system, user);
      const taskName = `${task.name}@${task.promptVersion}`;
      let lastError: AiError | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const started = now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), task.timeoutMs ?? timeoutMs);
        let model = provider.name;
        let inputTokens = 0;
        let outputTokens = 0;
        let outcome: AiOutcome = "ok";
        try {
          const response = await Promise.race([
            provider.generate({
              task: task.name,
              system,
              user,
              jsonSchema,
              signal: controller.signal,
              mock: () => task.mock(input),
            }),
            new Promise<never>((_, reject) => {
              controller.signal.addEventListener("abort", () =>
                reject(new AiError("timeout", "The AI call timed out")),
              );
            }),
          ]);
          model = response.model;
          inputTokens = response.inputTokens;
          outputTokens = response.outputTokens;

          let parsed: unknown;
          try {
            parsed = JSON.parse(response.text);
          } catch {
            throw new AiError("invalid_output", "The AI answer was not valid JSON");
          }
          const result = task.outputSchema.safeParse(parsed);
          if (!result.success) {
            throw new AiError("invalid_output", "The AI answer did not match the expected shape");
          }
          return result.data;
        } catch (error) {
          lastError = classifyError(error);
          outcome = lastError.kind;
          if (!lastError.retryable || attempt === maxAttempts) throw lastError;
        } finally {
          clearTimeout(timer);
          await context.recorder?.record({
            task: taskName,
            model,
            inputTokens,
            outputTokens,
            latencyMs: now() - started,
            outcome,
            inputHash,
          });
        }
        const base = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 1_000;
        await sleep(base + Math.floor(random() * base * 0.25));
      }
      throw lastError ?? new AiError("server_error", "The AI call failed");
    },
  };
}

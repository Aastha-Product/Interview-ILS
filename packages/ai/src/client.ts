import { createHash } from "node:crypto";
import { z } from "zod";
import { AiError, classifyError } from "./errors";
import type { AiOutcome, AiProvider, AiRecorder, TaskDefinition } from "./types";

export interface CircuitBreakerOptions {
  /** Outage failures (timeouts, 429s, 5xx, network) within `windowMs` that open the circuit. */
  failureThreshold: number;
  windowMs: number;
  /** How long the circuit stays open: calls use the fallback, or fail fast without one. */
  openMs: number;
}

/** Brief §6: after 5 failures in a minute, use the fallback model for 2 minutes. */
export const DEFAULT_BREAKER: CircuitBreakerOptions = { failureThreshold: 5, windowMs: 60_000, openMs: 120_000 };

export interface AiClientOptions {
  provider: AiProvider;
  /** Used while the primary's circuit is open, and once after the primary used up its retries. */
  fallback?: AiProvider;
  breaker?: CircuitBreakerOptions;
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
  /**
   * Epoch ms after which no new attempt starts and the current one is cut short. Queue jobs pass
   * one so a run always ends before pg-boss expires the job (which would start a duplicate run).
   */
  deadline?: number;
}

export interface AiClient {
  readonly providerName: string;
  run<I, O>(task: TaskDefinition<I, O>, input: I, context?: RunContext): Promise<O>;
}

/** Returns a client whose every call carries `deadline` (unless the call passes its own). */
export function withDeadline(client: AiClient, deadline: number): AiClient {
  return {
    providerName: client.providerName,
    run: (task, input, context = {}) => client.run(task, input, { ...context, deadline: context.deadline ?? deadline }),
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Failures that say the provider is down or overloaded (not that one answer was bad). */
const OUTAGE_KINDS = new Set<AiOutcome>(["timeout", "rate_limited", "server_error", "network_error"]);

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
 * The single entry point for model calls: timeout, retries with backoff and jitter, a circuit
 * breaker with an optional fallback provider, Zod validation, and a usage record per attempt.
 * The breaker's state lives in this client, so it is per process (web and worker each keep one).
 */
export function createAiClient(options: AiClientOptions): AiClient {
  const {
    provider: primary,
    fallback,
    breaker = DEFAULT_BREAKER,
    timeoutMs = 60_000,
    maxAttempts = 3,
    backoffMs = [1_000, 2_000, 4_000],
    sleep = defaultSleep,
    random = Math.random,
    now = Date.now,
  } = options;

  let recentFailures: number[] = [];
  let openUntil = 0;

  const circuitOpen = () => now() < openUntil;
  const recordPrimaryFailure = () => {
    const t = now();
    recentFailures = recentFailures.filter((at) => at > t - breaker.windowMs);
    recentFailures.push(t);
    if (recentFailures.length >= breaker.failureThreshold) {
      openUntil = t + breaker.openMs;
      recentFailures = [];
    }
  };

  return {
    providerName: primary.name,
    async run(task, input, context = {}) {
      const { system, user } = task.buildPrompt(input);
      const jsonSchema = toModelJsonSchema(task.outputSchema);
      const inputHash = hashInput(system, user);
      const taskName = `${task.name}@${task.promptVersion}`;

      /** One call to one provider: timeout, parse, validate, record. */
      const attempt = async (provider: AiProvider) => {
        const started = now();
        const remaining = context.deadline === undefined ? Infinity : context.deadline - started;
        if (remaining <= 0) throw new AiError("timeout", "No time left for the AI call");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(task.timeoutMs ?? timeoutMs, remaining));
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
              controller.signal.addEventListener("abort", () => reject(new AiError("timeout", "The AI call timed out")));
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
          const aiError = classifyError(error);
          outcome = aiError.kind;
          throw aiError;
        } finally {
          clearTimeout(timer);
          await context.recorder?.record({ task: taskName, model, inputTokens, outputTokens, latencyMs: now() - started, outcome, inputHash });
        }
      };

      let lastError: AiError | undefined;
      let usedFallback = false;
      for (let n = 1; n <= maxAttempts; n++) {
        const provider = circuitOpen() ? fallback : primary;
        if (!provider) {
          // Fail fast while the primary is known to be down and there's nothing to fall back to.
          throw new AiError("circuit_open", "The AI service is unavailable right now");
        }
        if (provider === fallback) usedFallback = true;
        try {
          return await attempt(provider);
        } catch (error) {
          lastError = error as AiError;
          if (provider === primary && OUTAGE_KINDS.has(lastError.kind)) recordPrimaryFailure();
          if (!lastError.retryable || n === maxAttempts) break;
        }
        const base = backoffMs[Math.min(n - 1, backoffMs.length - 1)] ?? 1_000;
        const wait = base + Math.floor(random() * base * 0.25);
        // Don't sleep into a deadline only to give up afterwards.
        if (context.deadline !== undefined && now() + wait >= context.deadline) break;
        await sleep(wait);
      }

      // The primary used up its retries on an outage: give the fallback one try before failing.
      if (fallback && !usedFallback && lastError && OUTAGE_KINDS.has(lastError.kind)) {
        try {
          return await attempt(fallback);
        } catch (error) {
          lastError = error as AiError;
        }
      }
      throw lastError ?? new AiError("server_error", "The AI call failed");
    },
  };
}

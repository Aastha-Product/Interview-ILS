import "server-only";

import { AiProvider } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";

import type { AiConfig } from "./config";
import { AiError, toAiError } from "./errors";
import type { AIProvider, CompletionRequest, JsonCompletionRequest, TokenUsage } from "./provider";

// Pathfinder: on the server's own Claude key, each task runs on the model it needs, a busy
// model hands over to a backup, and every call goes into the cost log (AiCall). Students with
// their own key in Settings choose their model themselves and aren't logged.

/** Tasks that copy what's written somewhere into fields: careful reading, no judgement. */
export const READING_TASKS = new Set(["extracted_profile", "extracted_posting"]);

/** The models a task may use on the server's Claude key. */
export type ModelRoutes = {
  /** For everything else, e.g. the resume review: DOSSIER_AI_MODEL. */
  main: string;
  /** For READING_TASKS. */
  reading: string;
  /** Tried once when the first model is overloaded, limiting requests or failing; null for none. */
  fallback: string | null;
};

export const DEFAULT_READING_MODEL = "claude-sonnet-5-5";
export const DEFAULT_FALLBACK_MODEL = "claude-sonnet-5-5";

/** List prices in US dollars per million tokens (input, output), for the cost log. */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

/** What `usage` cost, in millionths of a dollar; null for a model without a known price. */
export function costMicroUsd(usage: TokenUsage): number | null {
  const price = MODEL_PRICES[usage.model];
  if (!price) return null;
  return Math.round(usage.input * price.input + usage.output * price.output);
}

/** Failures another model might not have: the first one is overloaded, limited or broken. */
const HANDS_OVER = new Set(["busy", "rate-limited", "provider", "unreachable"]);

/** The routes from the environment, for a config whose main model is `main`. */
export function modelRoutes(main: string, source: Pick<typeof env, "PATHFINDER_AI_READING_MODEL" | "PATHFINDER_AI_FALLBACK_MODEL"> = env): ModelRoutes {
  const fallback = source.PATHFINDER_AI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL;
  return {
    main,
    reading: source.PATHFINDER_AI_READING_MODEL ?? DEFAULT_READING_MODEL,
    fallback: fallback === "off" ? null : fallback,
  };
}

/** One logged call: what the cost log keeps. */
export type CallRecord = { task: string; usage: TokenUsage[]; model: string; outcome: string };

/** Writes a call to the cost log for the current student; never fails the request it belongs to. */
export async function recordCall({ task, usage, model, outcome }: CallRecord): Promise<void> {
  const inputTokens = usage.reduce((sum, call) => sum + call.input, 0);
  const outputTokens = usage.reduce((sum, call) => sum + call.output, 0);
  const costs = usage.map(costMicroUsd);
  const costMicro = costs.every((cost) => cost !== null) ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0) : null;
  try {
    await prisma.aiCall.create({ data: { task, model, inputTokens, outputTokens, costMicroUsd: costMicro, outcome } });
  } catch (error) {
    logServerError("AI cost log", error);
  }
}

/**
 * `forModel(model)` providers combined: each request goes to its task's model, hands over to the
 * fallback once when that model is busy, and is logged with `record`.
 */
export function routedProvider(
  forModel: (model: string) => AIProvider,
  routes: ModelRoutes,
  record: (call: CallRecord) => Promise<void> = recordCall,
): AIProvider {
  const main = forModel(routes.main);

  function complete(request: CompletionRequest): Promise<string>;
  function complete<T>(request: JsonCompletionRequest<T>): Promise<T>;
  async function complete<T>(request: CompletionRequest | JsonCompletionRequest<T>): Promise<string | T> {
    const task = ("schemaName" in request && request.schemaName) || "text";
    const first = READING_TASKS.has(task) ? routes.reading : routes.main;
    const attempt = async (model: string): Promise<string | T> => {
      const usage: TokenUsage[] = [];
      const withUsage = {
        ...request,
        onUsage: (call: TokenUsage) => {
          usage.push(call);
          request.onUsage?.(call);
        },
      };
      try {
        const answer = await forModel(model).complete(withUsage as JsonCompletionRequest<T>);
        await record({ task, usage, model, outcome: "ok" });
        return answer;
      } catch (error) {
        const failure = error instanceof AiError ? error : toAiError(error, { model });
        await record({ task, usage, model, outcome: failure.kind });
        throw failure;
      }
    };
    try {
      return await attempt(first);
    } catch (error) {
      const fallback = routes.fallback;
      if (!(error instanceof AiError) || !HANDS_OVER.has(error.kind) || !fallback || fallback === first || request.signal?.aborted) throw error;
      return attempt(fallback);
    }
  }

  return {
    kind: main.kind,
    model: main.model,
    complete,
    listModels: (signal) => main.listModels(signal),
    test: (signal) => main.test(signal),
  };
}

/** Whether `config` is the server's own Claude key, where routing and the cost log apply. */
export function routesApply(config: AiConfig): boolean {
  return config.sharedKey && config.provider === AiProvider.ANTHROPIC && Boolean(config.model);
}

/**
 * Whether calls on `config` go in the cost log without routing: the server's own key on another
 * provider (e.g. Gemini through its OpenAI-compatible API), so the admin console sees them too.
 */
export function logsOnly(config: AiConfig): boolean {
  return config.sharedKey && Boolean(config.model) && !routesApply(config);
}

/** Routes that keep every task on `model` with no backup: for the cost log alone. */
export function singleModel(model: string): ModelRoutes {
  return { main: model, reading: model, fallback: null };
}

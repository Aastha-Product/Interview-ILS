import "server-only";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER } from "@/lib/owner/scope";

import { AiError } from "./errors";
import type { AIProvider, CompletionRequest, JsonCompletionRequest } from "./provider";

// Pathfinder: the server's shared AI key (DOSSIER_AI_KEY) costs money for every request, so each
// student gets PATHFINDER_AI_DAILY_LIMIT requests a day on it. The count resets at midnight IST.
// Students who add their own key in Settings → AI provider pay for their own use and aren't limited.

const DAY_ZONE = "Asia/Kolkata";

/** The day in India, e.g. "2026-11-06": the limit resets at midnight IST. */
export function limitDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DAY_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Counts one request for the current student and refuses it once today's count is past the
 * limit. Counted before the request, so requests running at the same moment can't slip past.
 */
export async function chargeSharedAi(limit: number, now: Date = new Date()): Promise<void> {
  const day = limitDay(now);
  const { count } = await prisma.aiUsage.upsert({
    where: { userId_day: { userId: CURRENT_USER, day } },
    create: { day, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  if (count > limit) throw AiError.of("daily-limit");
}

/** How many shared-key requests the current student has made today. */
export async function sharedAiUsedToday(now: Date = new Date()): Promise<number> {
  const row = await prisma.aiUsage.findUnique({ where: { userId_day: { userId: CURRENT_USER, day: limitDay(now) } }, select: { count: true } });
  return row?.count ?? 0;
}

/**
 * `provider`, with each request counted against the daily limit when it uses the server's shared
 * key and PATHFINDER_AI_DAILY_LIMIT is set; otherwise `provider` as it is.
 */
export function withDailyLimit(provider: AIProvider, sharedKey: boolean, limit = env.PATHFINDER_AI_DAILY_LIMIT): AIProvider {
  if (!sharedKey || !limit) return provider;
  function complete(request: CompletionRequest): Promise<string>;
  function complete<T>(request: JsonCompletionRequest<T>): Promise<T>;
  async function complete<T>(request: CompletionRequest | JsonCompletionRequest<T>): Promise<string | T> {
    await chargeSharedAi(limit!);
    return provider.complete(request as JsonCompletionRequest<T>);
  }
  return {
    kind: provider.kind,
    model: provider.model,
    complete,
    listModels: (signal) => provider.listModels(signal),
    test: (signal) => provider.test(signal),
  };
}

import "server-only";

import { env } from "@/lib/env";
import { currentUserId } from "@/lib/owner/current";
import { prisma, systemPrisma } from "@/lib/prisma";
import { CURRENT_USER } from "@/lib/owner/scope";

import { AiError } from "./errors";
import type { AIProvider, CompletionRequest, JsonCompletionRequest } from "./provider";

// Pathfinder: the server's shared AI key (DOSSIER_AI_KEY) costs money for every request, so each
// student gets PATHFINDER_AI_DAILY_LIMIT requests a day on it. The count resets at midnight IST.
// Students who add their own key in Settings → AI provider pay for their own use and aren't limited.
// An admin can give one student a different allowance (User.aiDailyLimit, from /admin).

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
 * The current student's daily limit on the shared key, in requests: the allowance an admin set
 * for them, else PATHFINDER_AI_DAILY_LIMIT; null when neither is set (no limit).
 */
export async function studentDailyLimit(): Promise<number | null> {
  const fallback = env.PATHFINDER_AI_DAILY_LIMIT ?? null;
  const userId = await currentUserId().catch(() => null);
  if (!userId) return fallback;
  const user = await systemPrisma.user.findUnique({ where: { id: userId }, select: { aiDailyLimit: true } });
  return user?.aiDailyLimit ?? fallback;
}

/** A limit, or how to look it up when each request is made; null for none. */
export type LimitSource = number | null | (() => Promise<number | null>);

/**
 * `provider`, with each request counted against the daily limit when it uses the server's shared
 * key; otherwise `provider` as it is. By default the limit is looked up for the student making
 * the request (studentDailyLimit), so an allowance an admin changes applies at once.
 */
export function withDailyLimit(provider: AIProvider, sharedKey: boolean, limit: LimitSource = studentDailyLimit): AIProvider {
  if (!sharedKey || limit === null) return provider;
  function complete(request: CompletionRequest): Promise<string>;
  function complete<T>(request: JsonCompletionRequest<T>): Promise<T>;
  async function complete<T>(request: CompletionRequest | JsonCompletionRequest<T>): Promise<string | T> {
    const today = typeof limit === "function" ? await limit() : limit;
    if (today !== null) await chargeSharedAi(today);
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

/** AI requests one resume analysis makes: reading the resume, then reviewing it. */
export const REQUESTS_PER_ANALYSIS = 2;

/** How many resume analyses the daily limit allows, or null when there's no limit. */
export function analysesPerDay(limit: number | null | undefined = env.PATHFINDER_AI_DAILY_LIMIT): number | null {
  if (limit === null || limit === undefined) return null;
  // An admin may stop a student's free analyses with an allowance of 0.
  return limit === 0 ? 0 : Math.max(1, Math.floor(limit / REQUESTS_PER_ANALYSIS));
}

/**
 * How many more analyses the current student can run today on the server's key, as the
 * dashboard shows it; null when they aren't limited (no limit, or their own key).
 */
export async function analysesLeftToday(
  sharedKey: boolean,
  limit: number | null | undefined = env.PATHFINDER_AI_DAILY_LIMIT,
  now: Date = new Date(),
): Promise<number | null> {
  if (!sharedKey || limit === null || limit === undefined) return null;
  return Math.max(0, Math.floor((limit - (await sharedAiUsedToday(now))) / REQUESTS_PER_ANALYSIS));
}

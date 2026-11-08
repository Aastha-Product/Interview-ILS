import "server-only";

import { limitDay, REQUESTS_PER_ANALYSIS } from "@/lib/ai/daily-limit";
import { env } from "@/lib/env";
import { systemPrisma } from "@/lib/prisma";

// Pathfinder: what the admin console shows. Counts, tokens and costs only: never a resume, an
// analysis, a profile or a prompt. It reads across students, so it uses the unscoped client and
// is only called from pages that require an admin (requireAdmin).

const DAY = 24 * 60 * 60 * 1000;

/** AI calls and what they cost, for one period or one model. */
export type AiTotals = {
  calls: number;
  /** Calls that failed: the model was busy, the answer was cut off, and so on. */
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /** In US dollars, for the calls whose model has a known price. */
  costUsd: number;
  /** Calls whose model has no known price, so they aren't in costUsd. */
  unpriced: number;
};

export type AdminStudent = {
  id: string;
  email: string;
  name: string;
  joined: Date;
  analyses: number;
  /** AI requests on the shared key today (India time). */
  requestsToday: number;
  /** The allowance an admin set, in analyses a day; null means the server's default. */
  allowance: number | null;
  /** AI cost in the last 30 days, in US dollars. */
  costUsd30d: number;
};

export type AdminOverview = {
  students: { total: number; newToday: number; new7d: number; activeToday: number };
  analyses: { total: number; today: number; last7d: number };
  ai: { today: AiTotals; last7d: AiTotals; last30d: AiTotals; byModel: (AiTotals & { model: string })[] };
  /** The server's default, in analyses a day; null when there's no limit. */
  defaultAllowance: number | null;
  /** The newest students first, at most STUDENT_LIMIT of them. */
  studentList: AdminStudent[];
  feedback: { id: string; email: string; page: string; message: string; createdAt: Date }[];
};

/** How many students the table lists. */
export const STUDENT_LIMIT = 200;

const usd = (micro: number | null | undefined) => (micro ?? 0) / 1_000_000;

type CallSums = {
  _count: { _all: number };
  _sum: { inputTokens: number | null; outputTokens: number | null; costMicroUsd: number | null };
};

function totals(all: CallSums | undefined, failed: number, unpriced: number): AiTotals {
  return {
    calls: all?._count._all ?? 0,
    failed,
    inputTokens: all?._sum.inputTokens ?? 0,
    outputTokens: all?._sum.outputTokens ?? 0,
    costUsd: usd(all?._sum.costMicroUsd),
    unpriced,
  };
}

const callSums = { _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true } } as const;

async function aiTotals(since: Date): Promise<AiTotals> {
  const where = { createdAt: { gte: since } };
  const [all, failed, unpriced] = await Promise.all([
    systemPrisma.aiCall.aggregate({ where, ...callSums }),
    systemPrisma.aiCall.count({ where: { ...where, outcome: { not: "ok" } } }),
    systemPrisma.aiCall.count({ where: { ...where, costMicroUsd: null } }),
  ]);
  return totals(all, failed, unpriced);
}

/** Everything the admin console shows, as of `now`. */
export async function loadAdminOverview(now: Date = new Date()): Promise<AdminOverview> {
  const today = new Date(now.getTime() - DAY);
  const week = new Date(now.getTime() - 7 * DAY);
  const month = new Date(now.getTime() - 30 * DAY);
  const day = limitDay(now);

  const [total, newToday, new7d, activeToday, analysesTotal, analysesToday, analyses7d, aiToday, ai7d, ai30d, models, failedByModel, unpricedByModel] =
    await Promise.all([
      systemPrisma.user.count(),
      systemPrisma.user.count({ where: { createdAt: { gte: today } } }),
      systemPrisma.user.count({ where: { createdAt: { gte: week } } }),
      systemPrisma.aiUsage.count({ where: { day } }),
      systemPrisma.resumeAnalysis.count(),
      systemPrisma.resumeAnalysis.count({ where: { createdAt: { gte: today } } }),
      systemPrisma.resumeAnalysis.count({ where: { createdAt: { gte: week } } }),
      aiTotals(today),
      aiTotals(week),
      aiTotals(month),
      systemPrisma.aiCall.groupBy({ by: ["model"], where: { createdAt: { gte: month } }, ...callSums, orderBy: { model: "asc" } }),
      systemPrisma.aiCall.groupBy({ by: ["model"], where: { createdAt: { gte: month }, outcome: { not: "ok" } }, _count: { _all: true } }),
      systemPrisma.aiCall.groupBy({ by: ["model"], where: { createdAt: { gte: month }, costMicroUsd: null }, _count: { _all: true } }),
    ]);
  const countOf = (rows: { model: string; _count: { _all: number } }[], model: string) => rows.find((row) => row.model === model)?._count._all ?? 0;

  const users = await systemPrisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: STUDENT_LIMIT,
    select: { id: true, email: true, name: true, createdAt: true, aiDailyLimit: true, _count: { select: { resumeAnalyses: true } } },
  });
  const ids = users.map((user) => user.id);
  const [usage, costs, feedback] = await Promise.all([
    systemPrisma.aiUsage.findMany({ where: { day, userId: { in: ids } }, select: { userId: true, count: true } }),
    systemPrisma.aiCall.groupBy({ by: ["userId"], where: { userId: { in: ids }, createdAt: { gte: month } }, _sum: { costMicroUsd: true } }),
    systemPrisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, page: true, message: true, createdAt: true, user: { select: { email: true } } },
    }),
  ]);
  const usedToday = new Map(usage.map((row) => [row.userId, row.count]));
  const cost30d = new Map(costs.map((row) => [row.userId, usd(row._sum.costMicroUsd)]));

  return {
    students: { total, newToday, new7d, activeToday },
    analyses: { total: analysesTotal, today: analysesToday, last7d: analyses7d },
    ai: {
      today: aiToday,
      last7d: ai7d,
      last30d: ai30d,
      byModel: models.map((row) => ({ model: row.model, ...totals(row, countOf(failedByModel, row.model), countOf(unpricedByModel, row.model)) })),
    },
    defaultAllowance: allowanceFromLimit(env.PATHFINDER_AI_DAILY_LIMIT ?? null),
    studentList: users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      joined: user.createdAt,
      analyses: user._count.resumeAnalyses,
      requestsToday: usedToday.get(user.id) ?? 0,
      allowance: allowanceFromLimit(user.aiDailyLimit),
      costUsd30d: cost30d.get(user.id) ?? 0,
    })),
    feedback: feedback.map(({ user, ...row }) => ({ ...row, email: user.email })),
  };
}

/** A limit in AI requests as analyses a day (two requests each); null stays null. */
export function allowanceFromLimit(limit: number | null): number | null {
  return limit === null ? null : Math.floor(limit / REQUESTS_PER_ANALYSIS);
}

/** Analyses a day as the limit in AI requests the daily limit counts; null stays null. */
export function limitFromAllowance(analyses: number | null): number | null {
  return analyses === null ? null : analyses * REQUESTS_PER_ANALYSIS;
}

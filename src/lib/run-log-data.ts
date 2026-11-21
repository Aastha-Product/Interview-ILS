import "server-only";

import { nextAgentRun } from "@/lib/agent/schedule";
import { loadAutoApply } from "@/lib/apply/settings";
import { dayOf } from "@/lib/calendar-view";
import { formatDateTime, formatDay } from "@/lib/dates";
import { findLatestJob } from "@/lib/jobs/runner";
import { MATCH_RUN_KEY } from "@/lib/match/jobs";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { toolsEnabled } from "@/lib/tools";

import { applyDays, daySummary, nextMatchAt, RUN_LOG_DAYS } from "./run-log";

export type AgentRunRow = { at: string; manual: boolean; message: string | null };
export type ApplyDayRow = { day: string; label: string; summary: string | null };

export type RunLogView = {
  /** Null without the job-search tools, which the agent is one of. */
  agent: { enabled: boolean; nextRun: string | null; runs: AgentRunRow[] } | null;
  autoApply: { enabled: boolean; lastMatch: string | null; nextMatch: string | null; days: ApplyDayRow[] };
};

const DAY_MS = 24 * 3600_000;

/** The Runs & schedule page: the agent's last runs and next, auto-apply's last week and next look. */
export async function loadRunLog(timeZone: string, now = new Date()): Promise<RunLogView> {
  const since = new Date(now.getTime() - (RUN_LOG_DAYS + 1) * DAY_MS);
  const [settings, autoApply, latestMatch, tasks] = await Promise.all([
    loadSettings(),
    loadAutoApply(),
    findLatestJob(MATCH_RUN_KEY),
    prisma.applyTask.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }, { appliedAt: { gte: since } }] },
      select: { createdAt: true, appliedAt: true, updatedAt: true, state: true },
    }),
  ]);
  const lastMatch = latestMatch ? (await prisma.job.findUnique({ where: { id: latestMatch.id }, select: { createdAt: true } }))?.createdAt ?? null : null;
  const today = dayOf(now, timeZone);

  return {
    agent: toolsEnabled()
      ? {
          enabled: settings.agentEnabled,
          nextRun: settings.agentEnabled ? formatDateTime(nextAgentRun(now, settings.agentHour, timeZone, settings.agentRuns), timeZone, now) : null,
          runs: settings.agentRuns.map((run) => ({ at: formatDateTime(new Date(run.at), timeZone, now), manual: run.manual, message: run.message })),
        }
      : null,
    autoApply: {
      enabled: autoApply.enabled,
      lastMatch: lastMatch ? formatDateTime(lastMatch, timeZone, now) : null,
      nextMatch: autoApply.enabled ? formatDateTime(nextMatchAt(lastMatch, now), timeZone, now) : null,
      days: applyDays(tasks, now, timeZone).map((day) => ({
        day: day.day,
        // Noon of that day, so the label doesn't slip a day at either edge.
        label: day.day === today ? "Today" : formatDay(new Date(`${day.day}T12:00:00Z`), "UTC", now),
        summary: daySummary(day),
      })),
    },
  };
}

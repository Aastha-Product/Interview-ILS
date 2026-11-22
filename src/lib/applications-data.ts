import "server-only";

import type { ApplicationStatus } from "@/generated/prisma/enums";
import { matchSchema, matchScore } from "@/lib/application-data";
import { sortRows, updatedAgo, type Sort } from "@/lib/applications-list";
import { DEFAULT_QUIET_DAYS } from "@/lib/dashboard";
import { formatCalendarDate, formatShortDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

/** An application as the board and the table show it (E9-2, E9-3). */
export type ApplicationRow = {
  id: string;
  company: string;
  /** The role, or the title when there's no role. */
  role: string;
  location: string;
  mode: string;
  status: ApplicationStatus;
  archived: boolean;
  /** "Apply by" on draft cards, e.g. "3 Oct 2026". */
  deadline: string | null;
  match: { hit: number; total: number } | null;
  /** When it was sent, e.g. "18 Aug"; null while never sent. */
  sent: string | null;
  /** "Today", "3 days ago"… */
  updated: string;
  /** For the board, which shows the latest update first. */
  updatedAt: number;
  /** How it was made, when not by hand (Phase 3): auto-apply or the job agent. */
  source?: "AUTO_APPLY" | "AGENT" | null;
  /** Sent (or in screening) and quiet for the follow-up days: worth a nudge (Phase 3). */
  followUp?: boolean;
  /** Replies from the employer waiting in the Inbox (Phase 3). */
  replies?: number;
};

/** What the board shows beside each card (Phase 3): when a quiet application deserves a follow-up, and the replies waiting. */
export type BoardContext = { quietDays?: number; replies?: Map<string, { count: number }> };

const DAY_MS = 24 * 3600_000;
const FOLLOW_UP_STATUSES = new Set(["SENT", "SCREENING"]);

/** Sent or in screening, not archived, and no change for `quietDays` or more. */
export const needsFollowUp = (row: { status: string; archived: boolean; updatedAt: Date }, quietDays: number, now: Date) =>
  FOLLOW_UP_STATUSES.has(row.status) && !row.archived && now.getTime() - row.updatedAt.getTime() >= quietDays * DAY_MS;

/** Every application, archived ones only when asked for, sorted for the table; agent drafts once approved (#195). */
export async function loadApplicationRows({ archived, sort }: { archived: boolean; sort: Sort }, now = new Date(), { quietDays = DEFAULT_QUIET_DAYS, replies }: BoardContext = {}) {
  const applications = await prisma.application.findMany({
    where: { awaitingReview: false, ...(archived ? {} : { archivedAt: null }) },
    select: {
      id: true,
      title: true,
      company: true,
      role: true,
      location: true,
      mode: true,
      status: true,
      archivedAt: true,
      deadline: true,
      match: true,
      sentAt: true,
      updatedAt: true,
      origin: true,
    },
  });
  const rows = applications.map((application) => {
    const match = matchSchema.safeParse(application.match);
    return {
      id: application.id,
      company: application.company.trim(),
      role: application.role.trim() || application.title.trim() || "Untitled application",
      location: application.location.trim(),
      mode: application.mode.trim(),
      status: application.status,
      archived: application.archivedAt !== null,
      deadline: application.deadline ? formatCalendarDate(application.deadline) : null,
      match: match.success && match.data.items.length > 0 ? matchScore(match.data) : null,
      sentAt: application.sentAt,
      updatedAt: application.updatedAt,
      source: application.origin === "MANUAL" ? null : application.origin,
      followUp: needsFollowUp({ status: application.status, archived: application.archivedAt !== null, updatedAt: application.updatedAt }, quietDays, now),
      replies: replies?.get(application.id)?.count ?? 0,
    };
  });
  return sortRows(rows, sort).map(({ sentAt, updatedAt, ...row }): ApplicationRow => ({
    ...row,
    sent: sentAt ? formatShortDate(sentAt, now) : null,
    updated: updatedAgo(updatedAt, now),
    updatedAt: updatedAt.getTime(),
  }));
}

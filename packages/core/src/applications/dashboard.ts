import type { ApplicationStatus, ScopedDb } from "@pathfinder/db";
import { getProfile } from "../profile/service";
import { profileStrength } from "../profile/strength";

/**
 * The success metric: response rate = responses ÷ applications sent.
 * - "Sent" means the student marked it applied (appliedAt is set).
 * - A "response" is any reply from the employer: a call or email, an interview, an offer or a
 *   rejection (responseAt is set the first time the status moves to one of those).
 * Weekly figures use India time, weeks starting Monday. The weekly rate is per cohort: of the
 * applications sent that week, how many have had a response so far.
 */

export interface DashboardRow {
  status: ApplicationStatus;
  appliedAt: Date | null;
  responseAt: Date | null;
  hasDraft: boolean;
}

export interface WeekStats {
  /** Monday of the week, YYYY-MM-DD (India time). */
  weekStart: string;
  sent: number;
  /** Responses received during this week (any cohort). */
  responsesReceived: number;
  /** Of the applications sent this week, how many got a response (so far). */
  cohortResponses: number;
  /** cohortResponses ÷ sent, or null when nothing was sent. */
  responseRate: number | null;
}

export interface Dashboard {
  totals: {
    sent: number;
    responses: number;
    responseRate: number | null;
    interviews: number;
    offers: number;
    drafts: number;
  };
  byStatus: Record<ApplicationStatus, number>;
  weeks: WeekStats[];
  nextSteps: string[];
}

const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 IST of the week containing `date`, returned as YYYY-MM-DD. */
export function istWeekStart(date: Date): string {
  const ist = new Date(date.getTime() + IST_MS);
  const day = ist.getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7;
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - back));
  return monday.toISOString().slice(0, 10);
}

const STATUSES: ApplicationStatus[] = ["DRAFT", "APPLIED", "RESPONSE", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"];

/** Pure calculation, so it can be tested on seeded data without a database. */
export function computeDashboard(
  rows: DashboardRow[],
  now: Date,
  options: { weeks?: number; profileScore?: number } = {},
): Dashboard {
  const weeksBack = options.weeks ?? 8;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const r of rows) byStatus[r.status]++;

  const sentRows = rows.filter((r) => r.appliedAt);
  const responded = sentRows.filter((r) => r.responseAt);

  const thisWeek = istWeekStart(now);
  const weekKeys: string[] = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const d = new Date(`${thisWeek}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7 * i);
    weekKeys.push(d.toISOString().slice(0, 10));
  }
  const weeks: WeekStats[] = weekKeys.map((weekStart) => {
    const cohort = sentRows.filter((r) => istWeekStart(r.appliedAt!) === weekStart);
    const cohortResponses = cohort.filter((r) => r.responseAt).length;
    return {
      weekStart,
      sent: cohort.length,
      responsesReceived: rows.filter((r) => r.responseAt && istWeekStart(r.responseAt) === weekStart).length,
      cohortResponses,
      responseRate: cohort.length ? cohortResponses / cohort.length : null,
    };
  });

  const drafts = rows.filter((r) => r.status === "DRAFT").length;
  const draftsReady = rows.filter((r) => r.status === "DRAFT" && r.hasDraft).length;
  const waiting = rows.filter(
    (r) => r.status === "APPLIED" && r.appliedAt && !r.responseAt && now.getTime() - r.appliedAt.getTime() > 14 * DAY_MS,
  ).length;
  const sentThisWeek = weeks.at(-1)?.sent ?? 0;

  const nextSteps: string[] = [];
  if (draftsReady > 0) {
    nextSteps.push(`You have ${draftsReady} draft${draftsReady === 1 ? "" : "s"} ready. Review, download the PDF and apply on the job page.`);
  }
  if (waiting > 0) {
    nextSteps.push(
      `${waiting} application${waiting === 1 ? " has" : "s have"} had no reply for over 2 weeks. A short, polite follow-up email to the recruiter can help.`,
    );
  }
  if (options.profileScore !== undefined && options.profileScore < 70) {
    nextSteps.push("Strengthen your profile: add project details and skills. Stronger profiles produce better drafts.");
  }
  if (sentThisWeek < 5) {
    nextSteps.push(`You've sent ${sentThisWeek} application${sentThisWeek === 1 ? "" : "s"} this week. Aim for about 5 well-matched ones rather than many generic ones.`);
  }
  if (responded.length === 0 && sentRows.length >= 10) {
    nextSteps.push("No responses yet after 10 applications. Try roles with a higher match score, and close the gaps they show.");
  }

  return {
    totals: {
      sent: sentRows.length,
      responses: responded.length,
      responseRate: sentRows.length ? responded.length / sentRows.length : null,
      interviews: rows.filter((r) => r.status === "INTERVIEW" || r.status === "OFFER").length,
      offers: byStatus.OFFER,
      drafts,
    },
    byStatus,
    weeks,
    nextSteps: nextSteps.slice(0, 3),
  };
}

export async function getDashboard(db: ScopedDb, now: Date = new Date()): Promise<Dashboard> {
  const [apps, profile] = await Promise.all([
    db.application.findMany({
      select: { status: true, appliedAt: true, responseAt: true, documents: { select: { id: true }, take: 1 } },
    }),
    getProfile(db),
  ]);
  return computeDashboard(
    apps.map((a) => ({ status: a.status, appliedAt: a.appliedAt, responseAt: a.responseAt, hasDraft: a.documents.length > 0 })),
    now,
    { profileScore: profile.version ? profileStrength(profile).score : undefined },
  );
}

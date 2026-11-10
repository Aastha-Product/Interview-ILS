import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { systemPrisma } from "@/lib/prisma";

import type { MatchPreferences } from "./preferences";
import { forNewGraduates, type SearchQueries } from "./query";

// Pathfinder (auto-apply step 3): the first, free pass of matching. Postgres's full-text search
// ranks the shared pool for a student, after hard filters (open jobs only, the student's countries
// or open remote ones, employment type, not shortlisted before). The job's title against the
// target roles counts three times as much as the skills found in the whole job, so a recruiter's
// posting that lists a developer's skills doesn't outrank a developer job. For interns and new
// graduates, senior titles and jobs asking 3+ years are left out. Only the best few go on to the
// AI, which reads them in full.

const INTERN = "\\mintern";
/** Title rank weight against skills rank. */
const TITLE_WEIGHT = 3;

export type RankedJob = { id: string; rank: number };

/**
 * The open shared jobs that fit `preferences` best for `userId`, best first, leaving out the ones
 * already shortlisted for them. The JobMatch filter names the student itself: this reads the
 * shared pool with the unscoped client.
 */
export async function rankPool(userId: string, preferences: MatchPreferences, queries: SearchQueries, limit: number): Promise<RankedJob[]> {
  const countries = preferences.countries.length > 0 ? preferences.countries : ["in"];
  const where: Prisma.Sql[] = [
    Prisma.sql`p."closedAt" IS NULL`,
    Prisma.sql`p.search @@ to_tsquery('english', ${queries.any})`,
    Prisma.sql`NOT EXISTS (SELECT 1 FROM "JobMatch" m WHERE m."sharedPostingId" = p.id AND m."userId" = ${userId})`,
  ];

  const inCountries = Prisma.sql`p.country IN (${Prisma.join(countries)})`;
  const inCities =
    preferences.cities.length > 0
      ? Prisma.sql`(${Prisma.join(
          preferences.cities.map((city) => Prisma.sql`p.location ILIKE ${`%${city.replace(/[%_\\]/g, "")}%`}`),
          " OR ",
        )})`
      : Prisma.sql`TRUE`;
  const place = Prisma.sql`(${inCountries} AND ${inCities})`;
  where.push(preferences.remoteOk ? Prisma.sql`(${place} OR (p.remote = TRUE AND (p.country = '' OR ${inCountries})))` : place);

  // Boards rarely say a job's kind reliably, except that internships say so: only internships, or
  // no internships, is what the filter can tell apart.
  const types = new Set(preferences.employmentTypes);
  const internship = Prisma.sql`(p.title ~* ${INTERN} OR p."employmentType" ~* ${INTERN})`;
  if (types.size > 0 && !types.has("internship")) where.push(Prisma.sql`NOT ${internship}`);
  else if (types.size === 1) where.push(internship);

  const title = Prisma.sql`to_tsvector('english', p.title)`;
  const rankBy = (vector: Prisma.Sql, query: string | null) => (query ? Prisma.sql`ts_rank(${vector}, to_tsquery('english', ${query}))` : Prisma.sql`0`);
  const score = Prisma.sql`(${TITLE_WEIGHT} * (${rankBy(title, queries.roleWords)} + ${rankBy(title, queries.rolePhrases)}) + ${rankBy(Prisma.sql`p.search`, queries.skills ?? queries.any)})`;

  // Seniority is read from the text, so a few more are fetched than needed and the rest filtered here.
  const seniorityFiltered = preferences.level !== "experienced";
  const fetch = seniorityFiltered ? Math.min(500, limit * 5) : limit;
  const rows = await systemPrisma.$queryRaw<{ id: string; rank: number; title: string; description: string }[]>`
    SELECT p.id, ${score}::float8 AS rank, p.title, left(p.description, 8000) AS description
    FROM "SharedPosting" p
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY rank DESC, p."postedAt" DESC NULLS LAST, p.id
    LIMIT ${fetch}`;
  return rows
    .filter((row) => !seniorityFiltered || forNewGraduates(row.title, row.description))
    .slice(0, limit)
    .map((row) => ({ id: row.id, rank: Number(row.rank) }));
}

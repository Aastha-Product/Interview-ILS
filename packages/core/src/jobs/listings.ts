import { Prisma } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { dedupeKey, normaliseCompany, normaliseTitle, normaliseUrl, type NormalizedJob } from "@pathfinder/feeds";

export type JobListing = Prisma.JobListingModel;

/** Two postings seen within this window with the same URL or company|title|city are one job. */
export const DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Control characters (NUL and friends; tab and newlines are kept) that Postgres can't store or that
 * only serve to hide text. Pasted pages and feeds sometimes contain them.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (value: string) => value.replace(CONTROL_CHARS, "");

/** Feed payloads go into a JSONB column, which rejects NUL too. Drops it (as JSON writes it: \u0000). */
function cleanJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value).replaceAll("\\u0000", "")) as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Stores a job from any source, collapsing duplicates. Shared data, so it uses the raw client.
 *
 * 1. Same (source, sourceId): refresh its details and return it.
 * 2. Same normalised URL created in the last 30 days: return that listing.
 * 3. Same company|title|city key created in the last 30 days: return that listing.
 * 4. Otherwise create a new listing.
 */
export async function saveListing(job: NormalizedJob, opts: { now?: Date } = {}): Promise<JobListing> {
  const prisma = getPrisma();
  const now = opts.now ?? new Date();
  const urlNormalised = job.url ? normaliseUrl(job.url) : null;
  const key = dedupeKey(job);
  const fields = {
    urlNormalised,
    applyUrl: job.applyUrl,
    company: clean(job.company),
    title: clean(job.title),
    location: clean(job.location),
    remote: job.remote,
    employmentType: clean(job.employmentType),
    description: clean(job.description),
    dedupeKey: key,
    postedAt: job.postedAt,
    closedAt: job.closesAt && job.closesAt < now ? job.closesAt : null,
    raw: cleanJson(job.raw),
  };

  const bySourceId = await prisma.jobListing.findUnique({
    where: { source_sourceId: { source: job.source, sourceId: job.sourceId } },
  });
  if (bySourceId) return prisma.jobListing.update({ where: { id: bySourceId.id }, data: fields });

  const since = new Date(now.getTime() - DEDUPE_WINDOW_MS);
  if (urlNormalised) {
    const byUrl = await prisma.jobListing.findFirst({
      where: { urlNormalised, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    });
    if (byUrl) return byUrl;
  }
  // A key without a company or title would merge unrelated jobs.
  if (normaliseCompany(job.company) && normaliseTitle(job.title)) {
    const byKey = await prisma.jobListing.findFirst({
      where: { dedupeKey: key, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    });
    if (byKey) return byKey;
  }

  try {
    return await prisma.jobListing.create({
      data: { source: job.source, sourceId: job.sourceId, ...fields, createdAt: now },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another request stored the same posting a moment ago.
    return prisma.jobListing.findUniqueOrThrow({
      where: { source_sourceId: { source: job.source, sourceId: job.sourceId } },
    });
  }
}

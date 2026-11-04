import { Prisma } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { dedupeKey, normaliseCompany, normaliseTitle, normaliseUrl, type NormalizedJob } from "@pathfinder/feeds";

export type JobListing = Prisma.JobListingModel;

/** Two postings seen within this window with the same URL or company|title|city are one job. */
export const DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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
    company: job.company,
    title: job.title,
    location: job.location,
    remote: job.remote,
    employmentType: job.employmentType,
    description: job.description,
    dedupeKey: key,
    postedAt: job.postedAt,
    closedAt: job.closesAt && job.closesAt < now ? job.closesAt : null,
    raw: job.raw === undefined || job.raw === null ? Prisma.JsonNull : (job.raw as Prisma.InputJsonValue),
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

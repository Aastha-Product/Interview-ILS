import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { postedAgo, safeLink } from "@/lib/job-search/search";
import { systemPrisma } from "@/lib/prisma";

import { PUBLIC_MAX_PAGE, PUBLIC_PAGE_SIZE, type PublicJobsQuery } from "./public-jobs";

export type PublicJob = { id: string; title: string; company: string; location: string; remote: boolean; posted: string; url: string };
export type PublicJobsView = { jobs: PublicJob[]; total: number; pages: number; companies: number };

/** One page of open jobs in India (and remote ones open to it), newest first. */
export async function loadPublicJobs(query: PublicJobsQuery, now = new Date()): Promise<PublicJobsView> {
  const where: Prisma.SharedPostingWhereInput = {
    closedAt: null,
    // The jobs the crawler keeps are India's, or remote ones open to anywhere (no country).
    country: { in: ["in", ""] },
    ...(query.remote ? { remote: true } : {}),
    ...(query.city ? { location: { contains: query.city, mode: "insensitive" } } : {}),
    ...(query.q
      ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { companyName: { contains: query.q, mode: "insensitive" } }, { department: { contains: query.q, mode: "insensitive" } }] }
      : {}),
  };
  // Shared postings belong to no student, so they're read outside a student's scope.
  const [total, companies, rows] = await Promise.all([
    systemPrisma.sharedPosting.count({ where }),
    systemPrisma.sharedPosting.findMany({ where, distinct: ["companyId"], select: { companyId: true } }).then((found) => found.length),
    systemPrisma.sharedPosting.findMany({
      where,
      orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { firstSeenAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * PUBLIC_PAGE_SIZE,
      take: PUBLIC_PAGE_SIZE,
      select: { id: true, title: true, companyName: true, location: true, remote: true, postedAt: true, firstSeenAt: true, url: true },
    }),
  ]);
  return {
    total,
    companies,
    pages: Math.min(Math.ceil(total / PUBLIC_PAGE_SIZE), PUBLIC_MAX_PAGE),
    jobs: rows.map((row) => ({
      id: row.id,
      title: row.title.trim() || "Untitled role",
      company: row.companyName.trim(),
      location: row.location.trim(),
      remote: row.remote === true,
      posted: postedAgo((row.postedAt ?? row.firstSeenAt).toISOString(), now),
      // Only an ordinary web address: a posting's link comes from a job board.
      url: safeLink(row.url),
    })),
  };
}

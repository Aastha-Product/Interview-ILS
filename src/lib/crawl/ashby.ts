import "server-only";

import { z } from "zod";

import { CrawlError, getJson } from "./http";
import { countriesIn, countryCode } from "./place";
import { hash, tidy } from "./text";
import type { BoardAdapter, CrawledJob, ListedJob } from "./types";

// Ashby's public job posting API: no key, every listed job in one call
// (https://developers.ashbyhq.com/docs/public-job-posting-api). Applications go through
// jobs.ashbyhq.com's form.

const text = z.string().nullish().catch(null);
const address = z.object({ postalAddress: z.object({ addressCountry: text, addressLocality: text }).nullish().catch(null) }).nullish().catch(null);

const jobSchema = z.object({
  id: z.string().min(1),
  title: text,
  department: text,
  team: text,
  employmentType: text,
  location: text,
  secondaryLocations: z.array(z.object({ location: text, address })).nullish().catch(null),
  publishedAt: text,
  isListed: z.boolean().nullish().catch(null),
  isRemote: z.boolean().nullish().catch(null),
  address,
  jobUrl: text,
  applyUrl: text,
  descriptionPlain: text,
  compensation: z.object({ scrapeableCompensationSalarySummary: text, compensationTierSummary: text }).nullish().catch(null),
});

const answerSchema = z.object({ jobs: z.array(z.unknown()) });

const EMPLOYMENT: Record<string, string> = { FullTime: "Full-time", PartTime: "Part-time", Intern: "Internship", Contract: "Contract", Temporary: "Temporary" };

export const ashby: BoardAdapter = {
  system: "ASHBY",
  async list(company, signal) {
    const url = new URL(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.boardToken)}`);
    url.searchParams.set("includeCompensation", "true");
    const answer = answerSchema.safeParse(await getJson("ASHBY", url, signal));
    if (!answer.success) throw new CrawlError("changed", "Ashby answered in an unexpected shape.");

    const listed: ListedJob[] = [];
    for (const item of answer.data.jobs) {
      const parsed = jobSchema.safeParse(item);
      if (!parsed.success || parsed.data.isListed === false) continue;
      const job = parsed.data;
      const location = tidy(job.location ?? "");
      const secondary = job.secondaryLocations ?? [];
      const places = [location, ...secondary.map((place) => place.location ?? "")].filter(Boolean).join(" · ");
      const countries = [
        ...new Set(
          [job.address, ...secondary.map((place) => place.address)]
            .map((where) => countryCode(where?.postalAddress?.addressCountry))
            .concat(countriesIn(places))
            .filter(Boolean),
        ),
      ];
      const remote = job.isRemote ?? null;
      const postedAt = job.publishedAt ? new Date(job.publishedAt) : null;
      const crawled: CrawledJob = {
        externalId: job.id,
        title: tidy(job.title ?? ""),
        companyName: company.name,
        location,
        country: countries[0] ?? "",
        remote,
        employmentType: EMPLOYMENT[job.employmentType ?? ""] ?? tidy(job.employmentType ?? ""),
        department: tidy(job.department || job.team || ""),
        salary: tidy(job.compensation?.scrapeableCompensationSalarySummary || job.compensation?.compensationTierSummary || ""),
        description: tidy(job.descriptionPlain ?? ""),
        url: job.jobUrl ?? "",
        applyUrl: job.applyUrl ?? job.jobUrl ?? "",
        postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      };
      listed.push({ externalId: job.id, version: hash(JSON.stringify(crawled)), countries, remote, location: places, load: async () => crawled });
    }
    return listed;
  },
};

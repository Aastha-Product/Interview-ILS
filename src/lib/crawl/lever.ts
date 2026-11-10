import "server-only";

import { z } from "zod";

import { CrawlError, getJson } from "./http";
import { countriesIn, countryCode } from "./place";
import { hash, htmlToText, tidy } from "./text";
import type { BoardAdapter, CrawledJob, ListedJob } from "./types";

// Lever's Postings API: public, no key, every published job in one call
// (https://github.com/lever/postings-api). Applications go through jobs.lever.co's form.

const text = z.string().nullish().catch(null);

const jobSchema = z.object({
  id: z.string().min(1),
  text,
  createdAt: z.number().nullish().catch(null),
  country: text,
  workplaceType: text,
  descriptionPlain: text,
  additionalPlain: text,
  lists: z.array(z.object({ text, content: text })).nullish().catch(null),
  categories: z
    .object({ location: text, commitment: text, department: text, team: text, allLocations: z.array(z.string()).nullish().catch(null) })
    .nullish()
    .catch(null),
  salaryRange: z
    .object({ min: z.number().nullish(), max: z.number().nullish(), currency: text, interval: text })
    .nullish()
    .catch(null),
  hostedUrl: text,
  applyUrl: text,
});
type Job = z.output<typeof jobSchema>;

const INTERVALS: Record<string, string> = { "per-year-salary": "a year", "per-month-salary": "a month", "per-hour-wage": "an hour" };

function salaryOf(range: Job["salaryRange"]): string {
  if (!range || (range.min == null && range.max == null)) return "";
  const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const span = range.min != null && range.max != null && range.min !== range.max ? `${amount(range.min)}–${amount(range.max)}` : amount((range.min ?? range.max)!);
  return [range.currency, span, INTERVALS[range.interval ?? ""]].filter(Boolean).join(" ");
}

function remoteOf(workplaceType: string | null | undefined): boolean | null {
  if (workplaceType === "remote") return true;
  if (workplaceType === "onsite" || workplaceType === "hybrid") return false;
  return null;
}

function descriptionOf(job: Job): string {
  const lists = (job.lists ?? []).map((list) => [tidy(list.text ?? ""), htmlToText(list.content)].filter(Boolean).join("\n"));
  return tidy([job.descriptionPlain ?? "", ...lists, job.additionalPlain ?? ""].filter(Boolean).join("\n\n"));
}

export const lever: BoardAdapter = {
  system: "LEVER",
  async list(company, signal) {
    const url = new URL(`https://api.lever.co/v0/postings/${encodeURIComponent(company.boardToken)}`);
    url.searchParams.set("mode", "json");
    const answer = z.array(z.unknown()).safeParse(await getJson("LEVER", url, signal));
    if (!answer.success) throw new CrawlError("changed", "Lever answered in an unexpected shape.");

    const listed: ListedJob[] = [];
    for (const item of answer.data) {
      const parsed = jobSchema.safeParse(item);
      if (!parsed.success) continue;
      const job = parsed.data;
      const location = tidy(job.categories?.location ?? "");
      const places = [location, ...(job.categories?.allLocations ?? [])].join(" · ");
      const countries = [...new Set([countryCode(job.country), ...countriesIn(places)].filter(Boolean))];
      const remote = remoteOf(job.workplaceType);
      const crawled: CrawledJob = {
        externalId: job.id,
        title: tidy(job.text ?? ""),
        companyName: company.name,
        location,
        country: countries[0] ?? "",
        remote,
        employmentType: tidy(job.categories?.commitment ?? ""),
        department: tidy(job.categories?.department || job.categories?.team || ""),
        salary: salaryOf(job.salaryRange),
        description: descriptionOf(job),
        url: job.hostedUrl ?? "",
        applyUrl: job.applyUrl ?? job.hostedUrl ?? "",
        postedAt: job.createdAt ? new Date(job.createdAt) : null,
      };
      listed.push({
        externalId: job.id,
        // Lever has no "updated" time: the job itself, hashed.
        version: hash(JSON.stringify(crawled)),
        countries,
        remote,
        location: places,
        load: async () => crawled,
      });
    }
    return listed;
  },
};

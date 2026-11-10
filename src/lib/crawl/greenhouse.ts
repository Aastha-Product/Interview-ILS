import "server-only";

import { z } from "zod";

import { CrawlError, getJson } from "./http";
import { countriesIn } from "./place";
import { escapedHtmlToText, tidy } from "./text";
import type { BoardAdapter, CrawledJob, ListedJob } from "./types";

// Greenhouse's Job Board API: public, no key, every open job with its description in one call
// (https://developers.greenhouse.io/job-board.html). Applications go through the board's own form
// on job-boards.greenhouse.io, which the extension fills.

const text = z.string().nullish().catch(null);

const jobSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  title: text,
  company_name: text,
  absolute_url: text,
  updated_at: text,
  first_published: text,
  content: text,
  location: z.object({ name: text }).nullish().catch(null),
  departments: z.array(z.object({ name: text })).nullish().catch(null),
  offices: z.array(z.object({ name: text, location: text })).nullish().catch(null),
});

const answerSchema = z.object({ jobs: z.array(z.unknown()) });

const date = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

export const greenhouse: BoardAdapter = {
  system: "GREENHOUSE",
  async list(company, signal) {
    const token = encodeURIComponent(company.boardToken);
    const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
    url.searchParams.set("content", "true");
    const answer = answerSchema.safeParse(await getJson("GREENHOUSE", url, signal));
    if (!answer.success) throw new CrawlError("changed", "Greenhouse answered in an unexpected shape.");

    const listed: ListedJob[] = [];
    for (const item of answer.data.jobs) {
      const parsed = jobSchema.safeParse(item);
      if (!parsed.success) continue;
      const job = parsed.data;
      // Offices often say the country when the location is just a city or "Remote".
      const places = [job.location?.name, ...(job.offices ?? []).flatMap((office) => [office.name, office.location])].filter(Boolean).join(" · ");
      const location = tidy(job.location?.name ?? "");
      const remote = /\bremote\b/i.test(location) ? true : null;
      const countries = countriesIn(places);
      const crawled: CrawledJob = {
        externalId: job.id,
        title: tidy(job.title ?? ""),
        companyName: tidy(job.company_name ?? company.name),
        location,
        country: countries[0] ?? "",
        remote,
        employmentType: "",
        department: tidy(job.departments?.[0]?.name ?? ""),
        salary: "",
        description: escapedHtmlToText(job.content),
        url: job.absolute_url ?? "",
        // The board's own form, the same for every company, which the extension knows how to fill.
        applyUrl: `https://job-boards.greenhouse.io/${token}/jobs/${encodeURIComponent(job.id)}`,
        postedAt: date(job.first_published) ?? date(job.updated_at),
      };
      listed.push({
        externalId: job.id,
        version: `${job.updated_at ?? ""}`,
        countries,
        remote,
        location: places,
        load: async () => crawled,
      });
    }
    return listed;
  },
};

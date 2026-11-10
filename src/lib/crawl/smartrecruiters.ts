import "server-only";

import { z } from "zod";

import { CrawlError, getJson } from "./http";
import { countryCode } from "./place";
import { htmlToText, tidy } from "./text";
import type { BoardAdapter, CrawledJob, ListedJob } from "./types";

// SmartRecruiters' public Posting API: no key (https://developers.smartrecruiters.com). Big
// employers list thousands of jobs, and a description is a request of its own, so the list is
// asked per country the company is crawled for, and a job is loaded only when it's new or changed.

const PAGE = 100;
/** Ten thousand jobs per country at most, whatever the board says. */
const MAX_PAGES = 100;

const text = z.string().nullish().catch(null);
const label = z.object({ label: text }).nullish().catch(null);

const itemSchema = z.object({
  id: z.string().min(1),
  name: text,
  releasedDate: text,
  location: z.object({ city: text, country: text, remote: z.boolean().nullish().catch(null), fullLocation: text }).nullish().catch(null),
  typeOfEmployment: label,
  department: label,
  company: z.object({ name: text }).nullish().catch(null),
});
const pageSchema = z.object({ totalFound: z.number().nullish().catch(null), content: z.array(z.unknown()) });

const section = z.object({ title: text, text }).nullish().catch(null);
const detailSchema = z.object({
  postingUrl: text,
  applyUrl: text,
  jobAd: z
    .object({ sections: z.object({ jobDescription: section, qualifications: section, additionalInformation: section, companyDescription: section }).nullish().catch(null) })
    .nullish()
    .catch(null),
});

export const smartrecruiters: BoardAdapter = {
  system: "SMARTRECRUITERS",
  async list(company, signal) {
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.boardToken)}/postings`;
    const listed: ListedJob[] = [];
    const seen = new Set<string>();
    for (const country of company.countries) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(base);
        url.searchParams.set("limit", String(PAGE));
        url.searchParams.set("offset", String(page * PAGE));
        url.searchParams.set("country", country);
        const answer = pageSchema.safeParse(await getJson("SMARTRECRUITERS", url, signal));
        if (!answer.success) throw new CrawlError("changed", "SmartRecruiters answered in an unexpected shape.");
        for (const raw of answer.data.content) {
          const parsed = itemSchema.safeParse(raw);
          if (!parsed.success || seen.has(parsed.data.id)) continue;
          seen.add(parsed.data.id);
          listed.push(listedJob(parsed.data, company.name, base, signal));
        }
        const total = answer.data.totalFound ?? 0;
        if (answer.data.content.length < PAGE || (page + 1) * PAGE >= total) break;
      }
    }
    return listed;
  },
};

function listedJob(item: z.output<typeof itemSchema>, companyName: string, base: string, signal: AbortSignal): ListedJob {
  const location = tidy(item.location?.fullLocation?.replace(/,\s*,/g, ",") ?? item.location?.city ?? "");
  const countries = [countryCode(item.location?.country)].filter(Boolean);
  const remote = item.location?.remote ?? null;
  return {
    externalId: item.id,
    version: item.releasedDate ?? "",
    countries,
    remote,
    location,
    load: async (): Promise<CrawledJob> => {
      const detail = detailSchema.safeParse(await getJson("SMARTRECRUITERS", new URL(`${base}/${encodeURIComponent(item.id)}`), signal));
      if (!detail.success) throw new CrawlError("changed", "SmartRecruiters answered a job in an unexpected shape.");
      const sections = detail.data.jobAd?.sections;
      const description = [sections?.jobDescription, sections?.qualifications, sections?.additionalInformation]
        .map((part) => [tidy(part?.title ?? ""), htmlToText(part?.text)].filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n\n");
      const released = item.releasedDate ? new Date(item.releasedDate) : null;
      return {
        externalId: item.id,
        title: tidy(item.name ?? ""),
        companyName: tidy(item.company?.name ?? companyName),
        location,
        country: countries[0] ?? "",
        remote,
        employmentType: tidy(item.typeOfEmployment?.label ?? ""),
        department: tidy(item.department?.label ?? ""),
        salary: "",
        description: tidy(description),
        url: detail.data.postingUrl ?? "",
        applyUrl: detail.data.applyUrl ?? detail.data.postingUrl ?? "",
        postedAt: released && !Number.isNaN(released.getTime()) ? released : null,
      };
    },
  };
}

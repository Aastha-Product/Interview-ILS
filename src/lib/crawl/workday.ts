import "server-only";

import { z } from "zod";

import { countryName } from "@/lib/job-search/countries";

import { CrawlError, getJson, postJson } from "./http";
import { countriesIn, countryCode } from "./place";
import { hash, htmlToText, tidy } from "./text";
import type { BoardAdapter, BoardCompany, CrawledJob, ListedJob } from "./types";

// Workday career sites (Phase 2): <tenant>.wd<N>.myworkdayjobs.com/<site>. The public site reads
// its jobs from /wday/cxs/<tenant>/<site>/jobs (a search, POSTed, 20 at a time) and each job from
// /wday/cxs/<tenant>/<site><externalPath>; no key or sign-in. This is the site's own data rather
// than a documented API, so it's read gently: only the company's countries where the site has a
// country filter, and at most MAX_JOBS jobs. Applying needs the student's own Workday account
// there, so the extension doesn't fill these forms: students apply by the link.

const PAGE = 20;
/** The most jobs read from one site in a crawl. */
export const MAX_JOBS = 400;

const text = z.string().nullish().catch(null);

const listSchema = z.object({
  total: z.number().catch(0),
  jobPostings: z.array(z.unknown()).catch([]),
  facets: z
    .array(z.object({ facetParameter: z.string().catch(""), values: z.array(z.object({ descriptor: z.string().catch(""), id: z.string().catch("") })).catch([]) }).passthrough())
    .nullish()
    .catch(null),
});

const itemSchema = z.object({
  title: text,
  externalPath: z.string().min(1),
  locationsText: text,
  bulletFields: z.array(z.string()).nullish().catch(null),
});

const detailSchema = z.object({
  jobPostingInfo: z.object({
    id: text,
    title: text,
    jobDescription: text,
    location: text,
    additionalLocations: z.array(z.string()).nullish().catch(null),
    startDate: text,
    timeType: text,
    jobReqId: text,
    externalUrl: text,
    country: z.object({ descriptor: text }).nullish().catch(null),
    remoteType: text,
  }),
});

/** "nvidia.wd5/NVIDIAExternalCareerSite" → its host and the API's base path; null when it isn't one. */
export function workdaySite(boardToken: string): { host: string; base: string; site: string } | null {
  const match = /^([a-z0-9][a-z0-9-]*)\.(wd\d{1,3})\/([A-Za-z0-9_-]{1,100})$/.exec(boardToken);
  if (!match) return null;
  const [, tenant, wd, site] = match;
  return { host: `${tenant}.${wd}.myworkdayjobs.com`, base: `/wday/cxs/${tenant}/${site}`, site };
}

/** The site's country filter for `countries`, where it has one: { facet: ids }. */
function countryFacets(facets: z.output<typeof listSchema>["facets"], countries: readonly string[]): Record<string, string[]> | null {
  const names = new Set(countries.map((code) => countryName(code).toLowerCase()).filter(Boolean));
  for (const facet of facets ?? []) {
    if (!/country/i.test(facet.facetParameter)) continue;
    const ids = facet.values.filter((value) => names.has(value.descriptor.toLowerCase())).map((value) => value.id).filter(Boolean);
    if (ids.length > 0) return { [facet.facetParameter]: ids };
  }
  return null;
}

/** Remote when Workday says so, on site when it says that; null when it doesn't say. */
const remoteOf = (value: string | null | undefined) => (/remote/i.test(value ?? "") ? true : value ? false : null);

export const workday: BoardAdapter = {
  system: "WORKDAY",
  async list(company: BoardCompany, signal) {
    const site = workdaySite(company.boardToken);
    if (!site) throw new CrawlError("gone", `"${company.boardToken}" isn't a Workday site (tenant.wdN/site).`);
    const jobsUrl = new URL(`https://${site.host}${site.base}/jobs`);
    const search = (offset: number, appliedFacets: Record<string, string[]>) => postJson("WORKDAY", jobsUrl, { appliedFacets, limit: PAGE, offset, searchText: "" }, signal);

    const first = listSchema.safeParse(await search(0, {}));
    if (!first.success) throw new CrawlError("changed", "Workday answered in an unexpected shape.");
    // Only the company's countries, where the site can filter by country.
    const facets = countryFacets(first.data.facets, company.countries);
    let page = facets ? listSchema.safeParse(await search(0, facets)) : first;
    if (!page.success) throw new CrawlError("changed", "Workday answered in an unexpected shape.");
    const total = Math.min(page.data.total, MAX_JOBS);

    const items: z.output<typeof itemSchema>[] = [];
    for (let offset = 0; ; ) {
      for (const raw of page.data.jobPostings) {
        const parsed = itemSchema.safeParse(raw);
        if (parsed.success) items.push(parsed.data);
      }
      offset += PAGE;
      if (offset >= total || page.data.jobPostings.length === 0) break;
      signal.throwIfAborted();
      page = listSchema.safeParse(await search(offset, facets ?? {}));
      if (!page.success) break;
    }

    const filtered = facets !== null;
    return items.slice(0, MAX_JOBS).map((item): ListedJob => {
      const location = tidy(item.locationsText ?? "");
      // "3 Locations" names no country; with the country filter on, every job is in one of them.
      const named = countriesIn(location);
      const countries = filtered && named.length === 0 ? [...company.countries] : named;
      return {
        externalId: item.externalPath,
        // "Posted 2 Days Ago" changes every day: the job's own words, without it.
        version: hash(JSON.stringify([item.title, item.externalPath, item.locationsText, item.bulletFields])),
        countries,
        remote: null,
        location,
        async load(): Promise<CrawledJob> {
          const detail = detailSchema.safeParse(await getJson("WORKDAY", new URL(`https://${site.host}${site.base}${item.externalPath}`), signal));
          if (!detail.success) throw new CrawlError("changed", "Workday's job page answered in an unexpected shape.");
          const job = detail.data.jobPostingInfo;
          const places = [job.location, ...(job.additionalLocations ?? [])].map((place) => tidy(place ?? "")).filter(Boolean);
          const country = countryCode(job.country?.descriptor) || countriesIn(places.join(" · "))[0] || countries[0] || "";
          const started = job.startDate ? new Date(job.startDate) : null;
          const url = job.externalUrl || `https://${site.host}/${site.site}${item.externalPath}`;
          return {
            externalId: item.externalPath,
            title: tidy(job.title || item.title || ""),
            companyName: company.name,
            location: places.join(" · ") || location,
            country,
            remote: remoteOf(job.remoteType),
            employmentType: tidy(job.timeType ?? ""),
            department: "",
            salary: "",
            description: htmlToText(job.jobDescription),
            url,
            applyUrl: url,
            postedAt: started && !Number.isNaN(started.getTime()) ? started : null,
          };
        },
      };
    });
  },
};

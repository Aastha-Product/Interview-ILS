import "server-only";

import { z } from "zod";

import { CrawlError, getJson } from "./http";
import { countriesIn, countryCode } from "./place";
import { hash, htmlToText, tidy } from "./text";
import type { BoardAdapter, CrawledJob, ListedJob } from "./types";

// BambooHR's public careers pages (Phase 2): <company>.bamboohr.com/careers/list gives every open
// job (title, place, department) as JSON, and /careers/<id>/detail one job's description. No key;
// read 21 November 2026 from live boards. Applications go through /careers/<id>.

const text = z.string().nullish().catch(null);

const listSchema = z.object({
  result: z.array(z.unknown()).catch([]),
});

const itemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  jobOpeningName: text,
  departmentLabel: text,
  employmentStatusLabel: text,
  location: z.object({ city: text, state: text }).nullish().catch(null),
  atsLocation: z.object({ country: text, state: text, province: text, city: text }).nullish().catch(null),
  isRemote: z.boolean().nullish().catch(null),
});

const detailSchema = z.object({
  result: z.object({
    jobOpening: z.object({
      jobOpeningShareUrl: text,
      jobOpeningName: text,
      description: text,
      datePosted: text,
      location: z.object({ city: text, state: text, addressCountry: text }).nullish().catch(null),
      compensation: text,
    }),
  }),
});

/** "Pune, Maharashtra", from whichever of the two places BambooHR filled in. */
function placeOf(item: z.output<typeof itemSchema>): string {
  const ats = item.atsLocation;
  const parts = [ats?.city || item.location?.city, ats?.state || ats?.province || item.location?.state, ats?.country].map((part) => tidy(part ?? "")).filter(Boolean);
  return [...new Set(parts)].join(", ");
}

const boardUrl = (token: string, path: string) => new URL(`https://${encodeURIComponent(token)}.bamboohr.com/careers${path}`);

export const bamboohr: BoardAdapter = {
  system: "BAMBOOHR",
  async list(company, signal) {
    const answer = listSchema.safeParse(await getJson("BAMBOOHR", boardUrl(company.boardToken, "/list"), signal));
    if (!answer.success) throw new CrawlError("changed", "BambooHR answered in an unexpected shape.");

    const listed: ListedJob[] = [];
    for (const raw of answer.data.result) {
      const parsed = itemSchema.safeParse(raw);
      if (!parsed.success) continue;
      const item = parsed.data;
      const location = placeOf(item);
      const countries = [...new Set([countryCode(item.atsLocation?.country), ...countriesIn(location)].filter(Boolean))];
      const remote = item.isRemote ?? null;
      const url = boardUrl(company.boardToken, `/${encodeURIComponent(item.id)}`).toString();
      listed.push({
        externalId: item.id,
        // The list has no "updated" time: its entry, hashed. A changed description alone is read
        // at the next change to the entry.
        version: hash(JSON.stringify(item)),
        countries,
        remote,
        location,
        async load(): Promise<CrawledJob> {
          const detail = detailSchema.safeParse(await getJson("BAMBOOHR", boardUrl(company.boardToken, `/${encodeURIComponent(item.id)}/detail`), signal));
          if (!detail.success) throw new CrawlError("changed", "BambooHR's job page answered in an unexpected shape.");
          const job = detail.data.result.jobOpening;
          const place = location || [job.location?.city, job.location?.state, job.location?.addressCountry].map((part) => tidy(part ?? "")).filter(Boolean).join(", ");
          const posted = job.datePosted ? new Date(job.datePosted) : null;
          return {
            externalId: item.id,
            title: tidy(job.jobOpeningName || item.jobOpeningName || ""),
            companyName: company.name,
            location: place,
            country: countries[0] || countryCode(job.location?.addressCountry) || "",
            remote,
            employmentType: tidy(item.employmentStatusLabel ?? ""),
            department: tidy(item.departmentLabel ?? ""),
            salary: tidy(job.compensation ?? ""),
            description: htmlToText(job.description),
            url: job.jobOpeningShareUrl || url,
            applyUrl: url,
            postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
          };
        },
      });
    }
    return listed;
  },
};

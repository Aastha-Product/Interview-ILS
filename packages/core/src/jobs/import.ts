import { createHash } from "node:crypto";
import type { AiClient } from "@pathfinder/ai";
import type { ScopedDb } from "@pathfinder/db";
import { normaliseUrl, type NormalizedJob } from "@pathfinder/feeds";
import { z } from "zod";
import { UserFacingError } from "../errors";
import { getLogger } from "../logger";
import { fetchJobPage, pageFetchErrorToUserError, type FetchPageOptions } from "./fetch-page";
import { saveListing } from "./listings";
import { getMatch, type MatchView } from "./match";
import { parsePostingHtml } from "./posting";

const MIN_DESCRIPTION_CHARS = 200;

export const importJobInputSchema = z
  .object({
    url: z.string().trim().max(2000).optional().default(""),
    /** Pasted job description. When given, the page is not fetched. */
    text: z.string().trim().max(30_000).optional().default(""),
    title: z.string().trim().max(200).optional().default(""),
    company: z.string().trim().max(200).optional().default(""),
    location: z.string().trim().max(200).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (!v.url && !v.text) ctx.addIssue({ code: "custom", path: ["text"], message: "Paste a job link or the job description." });
    if (v.url && !normaliseUrl(v.url)) ctx.addIssue({ code: "custom", path: ["url"], message: "Enter a full web address starting with https://" });
    if (v.text) {
      if (v.text.length < MIN_DESCRIPTION_CHARS) {
        ctx.addIssue({ code: "custom", path: ["text"], message: "Paste the full job description (at least a few lines)." });
      }
      if (!v.title) ctx.addIssue({ code: "custom", path: ["title"], message: "Add the job title." });
      if (!v.company) ctx.addIssue({ code: "custom", path: ["company"], message: "Add the company name." });
    }
  });

export type ImportJobInput = z.input<typeof importJobInputSchema>;

const sha = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 40);

export interface ImportJobDeps {
  db: ScopedDb;
  ai: AiClient;
  fetchOptions?: FetchPageOptions;
  /** Injectable for tests. */
  fetchPage?: typeof fetchJobPage;
}

export interface ImportJobResult {
  jobListingId: string;
  match: MatchView;
}

/**
 * Adds a job the student found: from pasted text, or by fetching the single page they linked.
 * If the page can't be read (robots.txt, sign-in wall, script-only page) the student is asked to
 * paste the description instead (UserFacingError NEEDS_TEXT, 422).
 */
export async function importJob(deps: ImportJobDeps, rawInput: ImportJobInput): Promise<ImportJobResult> {
  const input = importJobInputSchema.parse(rawInput);
  const canonicalUrl = input.url ? normaliseUrl(input.url) : null;
  const log = getLogger().child({ op: "job.import" });

  let job: NormalizedJob;
  if (input.text) {
    job = {
      source: "manual",
      sourceId: canonicalUrl ? `url:${sha(canonicalUrl)}` : `text:${sha(input.text.replace(/\s+/g, " ").toLowerCase())}`,
      title: input.title,
      company: input.company,
      location: input.location,
      remote: /\b(remote|work from home|wfh)\b/i.test(input.text),
      employmentType: "",
      description: input.text,
      url: canonicalUrl,
      applyUrl: input.url || null,
      postedAt: null,
      closesAt: null,
      raw: { importedFrom: "text" },
    };
  } else {
    let page;
    try {
      page = await (deps.fetchPage ?? fetchJobPage)(input.url, deps.fetchOptions);
    } catch (error) {
      log.info({ kind: (error as { kind?: string }).kind ?? "unknown" }, "job page not fetched");
      throw pageFetchErrorToUserError(error);
    }
    const parsed = parsePostingHtml(page.body, page.finalUrl);
    if (parsed.description.length < MIN_DESCRIPTION_CHARS || !parsed.title) {
      throw new UserFacingError(
        "NEEDS_TEXT",
        "We couldn't find the job description on that page (it may need you to be signed in). Copy the description from the page and paste it here.",
        422,
      );
    }
    job = {
      source: "manual",
      sourceId: `url:${sha(canonicalUrl!)}`,
      title: input.title || parsed.title,
      company: input.company || parsed.company,
      location: input.location || parsed.location,
      remote: parsed.remote,
      employmentType: parsed.employmentType,
      description: parsed.description,
      url: canonicalUrl,
      applyUrl: input.url,
      postedAt: parsed.postedAt,
      closesAt: parsed.closesAt,
      raw: { importedFrom: "url", via: parsed.via },
    };
    log.info({ via: parsed.via, chars: parsed.description.length }, "job page parsed");
  }

  const listing = await saveListing(job);
  const match = await getMatch({ db: deps.db, ai: deps.ai }, listing.id, { explain: true });
  return { jobListingId: listing.id, match };
}

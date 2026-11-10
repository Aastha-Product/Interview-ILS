import type { BoardSystem } from "@/generated/prisma/enums";

// Pathfinder (auto-apply step 2): what every job-board adapter gives the crawler.

/** A job as the crawler stores it, whichever board it came from. */
export type CrawledJob = {
  externalId: string;
  title: string;
  companyName: string;
  location: string;
  /** ISO code ("in"), or "" when neither the board nor the place says. */
  country: string;
  remote: boolean | null;
  employmentType: string;
  department: string;
  salary: string;
  /** Plain text, paragraphs kept. */
  description: string;
  url: string;
  applyUrl: string;
  postedAt: Date | null;
};

/** A job as a board's list shows it: enough to decide whether to keep it, and to load it. */
export type ListedJob = {
  externalId: string;
  /** Changes when the job does, so an unchanged job isn't loaded or written again. */
  version: string;
  /** The countries it's in, as ISO codes; empty when unknown. */
  countries: string[];
  remote: boolean | null;
  /** Where it is, as the board writes it. */
  location: string;
  /** The whole job; a board that lists everything at once has it already. */
  load: () => Promise<CrawledJob>;
};

/** The company as an adapter needs it. */
export type BoardCompany = { name: string; boardToken: string; countries: string[] };

export type BoardAdapter = {
  system: BoardSystem;
  /** Every open job on the company's board (for SmartRecruiters, in its countries only). */
  list: (company: BoardCompany, signal: AbortSignal) => Promise<ListedJob[]>;
};

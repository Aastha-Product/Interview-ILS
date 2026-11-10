// Pathfinder (auto-apply): which jobs the extension can apply to. Only these become applications,
// so no AI is spent tailoring documents for a form it would only hand back to the student.

/** Where the extension fills forms: extension/src/boards.ts, and its manifest's host_permissions. */
export const EXTENSION_HOSTS: readonly string[] = ["job-boards.greenhouse.io", "boards.greenhouse.io", "jobs.lever.co", "jobs.eu.lever.co", "jobs.ashbyhq.com"];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/**
 * Whether the extension can fill this job's form: its board is one the extension knows
 * (SmartRecruiters isn't yet), and, on Greenhouse, the company didn't move the form to its own
 * site. Greenhouse then sends its page on to the company's (Okta, Stripe, Airbnb, Databricks),
 * and the job's own address in Greenhouse's API (`url`) says so.
 */
export function extensionCanApply(posting: { system: string; url: string; applyUrl: string }): boolean {
  if (!EXTENSION_HOSTS.includes(hostOf(posting.applyUrl))) return false;
  if (posting.system === "GREENHOUSE" && posting.url && !/(^|\.)greenhouse\.io$/.test(hostOf(posting.url))) return false;
  return true;
}

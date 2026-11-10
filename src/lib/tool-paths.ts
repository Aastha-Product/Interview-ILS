// Pathfinder: the pages of Dossier's job-search tools, for the proxy, which can't import
// server-only modules. Where the tools are off (PATHFINDER_TOOLS=off) they answer 404.

/**
 * The base resume, Find jobs, the job agent, Applications (and a new one), the Inbox, and
 * Pathfinder's auto-apply. The dashboard at "/" isn't here: without the tools it sends the student
 * to the resume analysis.
 */
const TOOL_PAGES = /^\/(?:resume|jobs|agent|applications|new|inbox|auto-apply)(?:\/|$)/;

/** Whether `pathname` is one of the job-search tools' pages. */
export function isToolPage(pathname: string): boolean {
  return TOOL_PAGES.test(pathname);
}

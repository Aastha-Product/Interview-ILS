import "server-only";

import { env } from "@/lib/env";

// Pathfinder: Dossier's job-search tools are off unless PATHFINDER_TOOLS=on. Students then see
// the resume analysis, their profile and a short Settings: nothing to set up. The tools' code
// stays, so a server can turn them back on.

/** The tools' sections in the sidebar, by path. */
export const TOOL_PATHS = ["/", "/resume", "/jobs", "/startups", "/agent", "/applications", "/inbox"] as const;

/** Whether this server offers the job-search tools. */
export function toolsEnabled(): boolean {
  return env.PATHFINDER_TOOLS === "on";
}

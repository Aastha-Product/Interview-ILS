import "server-only";

import { env } from "@/lib/env";

// Pathfinder: Dossier's job-search tools are on unless PATHFINDER_TOOLS=off. Off, students see
// the resume analysis, their profile and a short Settings, and the tools are closed on the server
// too: their pages answer 404 (proxy.ts), their actions refuse (toolAction) and their schedules
// don't run.

/** The tools' sections in the sidebar, by path. */
export const TOOL_PATHS = ["/", "/resume", "/jobs", "/startups", "/agent", "/applications", "/inbox"] as const;

/** Whether this server offers the job-search tools. */
export function toolsEnabled(): boolean {
  // Only an explicit off closes them: unset is on (env.ts), and so is a partial env in tests.
  return toolsSetting() !== "off";
}

/**
 * PATHFINDER_TOOLS as validated, or as set where the rest of the environment isn't complete (tests
 * and scripts; a running server checked its environment at startup, so there it's always the former).
 */
function toolsSetting(): string | undefined {
  try {
    return env.PATHFINDER_TOOLS;
  } catch {
    return process.env.PATHFINDER_TOOLS?.trim().toLowerCase();
  }
}

/** What a student reads when they reach a tool this server doesn't offer. */
export const TOOLS_OFF_MESSAGE = "This tool isn't available on Pathfinder right now.";

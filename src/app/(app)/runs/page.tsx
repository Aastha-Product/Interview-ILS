import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/auth/next-path";
import { loadRunLog } from "@/lib/run-log-data";
import { userTimeZone } from "@/lib/time-zone";
import { toolsEnabled } from "@/lib/tools";

import { RunsScreen } from "./runs-screen";

export const metadata: Metadata = { title: "Runs & schedule" };

/** Runs & schedule (Phase 3): what the job agent and auto-apply did lately, and when they run next. */
export default async function RunsPage() {
  // With auto-apply and the agent, among the job-search tools.
  if (!toolsEnabled()) redirect(HOME_PATH);
  const timeZone = (await userTimeZone()) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <RunsScreen view={await loadRunLog(timeZone)} timeZone={timeZone} />;
}

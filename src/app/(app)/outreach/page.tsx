import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/auth/next-path";
import { loadOutreachList } from "@/lib/outreach-data";
import { toolsEnabled } from "@/lib/tools";

import { OutreachScreen } from "./outreach-screen";

export const metadata: Metadata = { title: "Recruiter outreach" };

/** Recruiter outreach (Phase 3): an email to the recruiter for each open application. */
export default async function OutreachPage() {
  if (!toolsEnabled()) redirect(HOME_PATH);
  return <OutreachScreen rows={await loadOutreachList()} />;
}

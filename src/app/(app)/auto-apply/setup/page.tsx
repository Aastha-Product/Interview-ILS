import type { Metadata } from "next";

import { loadAutoApplyScreen } from "@/lib/apply/view";
import { COUNTRIES } from "@/lib/job-search/countries";

import { SetupScreen } from "./setup-screen";

export const metadata: Metadata = { title: "Set up job search" };

/** Set up job search (auto-apply step 4). */
export default async function SetupPage() {
  const view = await loadAutoApplyScreen();
  return <SetupScreen settings={view.settings} preferences={view.preferences} consentText={view.consentText} countries={COUNTRIES} />;
}

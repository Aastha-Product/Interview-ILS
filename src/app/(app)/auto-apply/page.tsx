import type { Metadata } from "next";

import { loadAutoApplyScreen } from "@/lib/apply/view";

import { AutoApplyScreen } from "./auto-apply-screen";

export const metadata: Metadata = { title: "Auto-apply" };

/** Auto-apply (step 4): whether it's on, what it found, and every application it prepared. */
export default async function AutoApplyPage() {
  return <AutoApplyScreen view={await loadAutoApplyScreen()} />;
}

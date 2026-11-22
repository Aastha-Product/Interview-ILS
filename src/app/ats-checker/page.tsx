import type { Metadata } from "next";

import { signInMode } from "@/lib/auth/google-sign-in";
import { getSession } from "@/lib/auth/session";

import { AtsCheckerScreen } from "./ats-checker-screen";

export const metadata: Metadata = {
  title: "Free ATS resume checker",
  description: "Check how an applicant tracking system reads your resume, and how well it fits a job. Free, no sign-up, and your resume never leaves your device.",
};

/**
 * The ATS checker (Phase 5): open to everyone, signed in or not. The checking runs in the
 * visitor's browser (src/lib/ats-check.ts); the server never sees the resume.
 */
export default async function AtsCheckerPage() {
  const session = await getSession();
  return <AtsCheckerScreen signedIn={session !== null} canSignUp={signInMode() === "firebase"} />;
}

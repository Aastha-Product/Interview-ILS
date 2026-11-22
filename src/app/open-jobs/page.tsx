import type { Metadata } from "next";

import { signInMode } from "@/lib/auth/google-sign-in";
import { getSession } from "@/lib/auth/session";
import { parsePublicJobsQuery } from "@/lib/public-jobs";
import { loadPublicJobs } from "@/lib/public-jobs-data";

import { OpenJobsScreen } from "./open-jobs-screen";

export const metadata: Metadata = {
  title: "Open jobs in India",
  description: "Open roles from companies' own job boards, updated every few hours. Let Pathfinder tailor your resume and apply for you.",
};

/**
 * The open jobs board (Phase 5): open to everyone, signed in or not. Lists the jobs the crawler
 * keeps from companies' public job boards; nothing about any student is read here.
 */
export default async function OpenJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parsePublicJobsQuery(await searchParams);
  const [view, session] = await Promise.all([loadPublicJobs(query), getSession()]);
  return <OpenJobsScreen view={view} query={query} signedIn={session !== null} canSignUp={signInMode() === "firebase"} />;
}

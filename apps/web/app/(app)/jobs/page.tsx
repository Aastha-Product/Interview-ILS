import { getPreferences, getProfile, listMatches } from "@pathfinder/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { JobsWorkspace } from "@/components/jobs/jobs-workspace";
import { Alert } from "@/components/ui/card";
import type { JobCardData } from "@/lib/jobs";
import { toJobSummary, toMatchSummary } from "@/server/jobs";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { db } = await requireUser();
  if ((await getProfile(db)).version === 0) redirect("/onboarding");
  const [preferences, matches] = await Promise.all([getPreferences(db), listMatches(db)]);
  const { welcome } = await searchParams;
  const myJobs: JobCardData[] = matches.map((m) => ({ job: toJobSummary(m.job), match: toMatchSummary(m) }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Jobs</h1>
        <p className="mt-1 text-slate-600">
          Search for jobs or paste one you found. We score each job against your profile and show what&apos;s missing.
        </p>
      </div>
      {welcome && (
        <Alert tone="success">
          You&apos;re all set. Search for a role below, or paste a job you found, to see how well you match.
        </Alert>
      )}
      <JobsWorkspace
        myJobs={myJobs}
        defaultQuery={preferences?.roles[0] ?? ""}
        defaultLocation={preferences?.locations[0] ?? ""}
      />
    </div>
  );
}

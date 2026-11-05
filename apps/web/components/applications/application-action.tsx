import Link from "next/link";
import { StartApplicationButton } from "@/components/applications/start-application-button";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS, STATUS_STYLES } from "@/lib/applications";
import type { ExistingApplication } from "@/lib/jobs";

/**
 * What a student can do with a job: open the application they already started (with its status),
 * or start one. Only one application per job is allowed, so offering "Start application" for a job
 * they already applied to just led to an "already started" message.
 */
export function ApplicationAction({
  jobListingId,
  application,
  size = "sm",
}: {
  jobListingId: string;
  application: ExistingApplication | null;
  size?: "sm" | "md";
}) {
  if (!application) return <StartApplicationButton jobListingId={jobListingId} size={size} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size={size}>
        <Link href={`/applications/${application.id}`}>View application</Link>
      </Button>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[application.status]}`}>
        {STATUS_LABELS[application.status]}
      </span>
    </div>
  );
}

// Next.js calls register() once when a server starts, before it handles any
// request. It doesn't run during `next build`, so the build needs no secrets.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvOnStartup } = await import("@/lib/env");
    checkEnvOnStartup();

    // Pathfinder: the shared access code lets anyone who has it in as any email.
    const { signInMode } = await import("@/lib/auth/google-sign-in");
    if (signInMode() === "code" && process.env.NODE_ENV === "production") {
      console.warn(
        "Sign-in: students sign in with the shared access code (DOSSIER_PASSWORD), and anyone with it can sign in as any email. " +
          "For real students, set DOSSIER_GOOGLE_CLIENT_ID and DOSSIER_GOOGLE_CLIENT_SECRET to sign in with Google.",
      );
    }

    // Pathfinder (P0 task 3): every process hears the others' job news; one that runs jobs (PATHFINDER_ROLE
    // all or worker) takes them from the queue in the database, and runs the schedules. A web process
    // (PATHFINDER_ROLE=web) only serves pages: its jobs wait in the queue for a worker.
    const { logServerError } = await import("@/lib/log");
    const { runsJobs, startJobEvents, startWorker } = await import("@/lib/jobs/runner");
    startJobEvents();
    if (runsJobs()) {
      // Jobs whose worker stopped can't finish (E6-7); the queued ones wait for this one.
      startWorker();

      // Finished jobs, with what they were given and wrote, are deleted after a while.
      const { startJobSweep } = await import("@/lib/jobs/retention");
      startJobSweep();

      // Nightly backups at 03:00, while they're switched on (E10-7).
      const { startBackupSchedule } = await import("@/lib/backup-schedule");
      startBackupSchedule();

      // Pathfinder: the inbox check and the job agent are job-search tools, so they run only where
      // the tools are on (PATHFINDER_TOOLS).
      const { toolsEnabled } = await import("@/lib/tools");
      if (toolsEnabled()) {
        // The inbox check, while a Google account is connected (E15-3).
        const { startInboxSchedule } = await import("@/lib/google/sync");
        startInboxSchedule();

        // The job agent's daily run, while it's on (E16-4).
        const { startAgentSchedule } = await import("@/lib/agent/schedule");
        startAgentSchedule();
      }

      // Startups' daily refresh, once it was refreshed by hand and while the screen is in use (#222).
      const { startStartupsSchedule } = await import("@/lib/startups/schedule");
      startStartupsSchedule();
    }

    // DOSSIER_JOBS_SOURCE=arbeitsagentur: the log says what that choice means (#223).
    // Pathfinder: settings belong to students, so this reads the first one's, only when it matters.
    const { arbeitsagenturStartupNotice, loadJobSearchConfig } = await import("@/lib/job-search/config");
    const { forEachStudent } = await import("@/lib/owner/students");
    if (process.env.DOSSIER_JOBS_SOURCE) {
      let shown = false;
      await forEachStudent("job search", async () => {
        const notice = shown ? null : arbeitsagenturStartupNotice(await loadJobSearchConfig());
        if (notice) console.log(notice);
        shown = true;
      }).catch((error: unknown) => logServerError("job search", error));
    }

    // The usage ping (#172) is off unless DOSSIER_TELEMETRY=on (Pathfinder). When it's on,
    // the log says what it sends.
    const { env } = await import("@/lib/env");
    const { USAGE_PING_NOTICE } = await import("@/lib/usage-ping");
    if (env.DOSSIER_TELEMETRY === "on" && process.env.NODE_ENV === "production") console.log(USAGE_PING_NOTICE);
  }
}

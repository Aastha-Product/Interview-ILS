import "server-only";

import { rm } from "node:fs/promises";
import path from "node:path";

import { JobStatus } from "@/generated/prisma/enums";
import { disconnectGoogle } from "@/lib/google/account";
import { cancelJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { runAsUser } from "@/lib/owner/context";
import { studentsRoot } from "@/lib/owner/students";
import { prisma, systemPrisma } from "@/lib/prisma";

/** What a student sees when the address they typed to confirm isn't theirs. */
export const DELETE_ACCOUNT_MISMATCH = "Type the email address you sign in with, exactly, to confirm.";

/**
 * Deletes a student's account and everything Pathfinder holds about them (DPDP Act, QA M-3):
 * stops their background work, revokes the Google connection, removes their folder (backups,
 * downloads) and deletes their account row. Every table the student owns references the account
 * with ON DELETE CASCADE, so their profile, analyses, applications, documents, settings, jobs,
 * feedback and AI usage go with it in the same statement. Their sessions end with it, since a
 * session for a student who no longer exists counts as signed out. Other students are untouched.
 *
 * Not covered here: the server's nightly copy of the whole database, which ages out on its own
 * (the privacy notice says how long).
 */
export async function deleteAccount(userId: string): Promise<void> {
  // Ids are cuids; refuse anything that could reach outside the student's own folder.
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("Unexpected student id");

  await runAsUser(userId, async () => {
    const unfinished = await prisma.job.findMany({ where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true } });
    for (const job of unfinished) await cancelJob(job.id);
    // Revokes Pathfinder's access at Google too; the account goes either way.
    await disconnectGoogle().catch((error: unknown) => logServerError("delete account (google)", error));
  });

  await rm(path.join(studentsRoot(), userId), { recursive: true, force: true });
  await systemPrisma.user.delete({ where: { id: userId } });
}

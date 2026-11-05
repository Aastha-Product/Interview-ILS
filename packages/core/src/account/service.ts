import { createHmac } from "node:crypto";
import { deleteUserCascade, type ScopedDb } from "@pathfinder/db";
import { recordAudit } from "../audit";
import { UserFacingError } from "../errors";
import { getLogger } from "../logger";
import { getPreferences, getProfile } from "../profile/service";
import type { FileStorage } from "../storage";

export const EXPORT_FORMAT = "pathfinder-export/v1";

/**
 * Everything Pathfinder holds about one student, as plain JSON (DPDP Act right of access).
 * Read only through the scoped client, so it can contain nothing of anyone else's. Login tokens
 * from Google (Auth.js accounts) are left out on purpose. Uploaded files are listed, not embedded.
 */
export async function exportAccount(db: ScopedDb, options: { ipHash?: string | null; now?: Date } = {}) {
  const user = await db.user.findFirst({ select: { email: true, name: true, image: true, createdAt: true } });
  if (!user) throw new UserFacingError("ACCOUNT_NOT_FOUND", "We couldn't find your account.", 404);

  const [profile, preferences, resumeFiles, applications, jobMatches, usage, aiRuns] = await Promise.all([
    getProfile(db),
    getPreferences(db),
    db.resumeFile.findMany({
      select: { mime: true, size: true, parsedAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.application.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        status: true,
        appliedAt: true,
        responseAt: true,
        notes: true,
        createdAt: true,
        jobListing: { select: { title: true, company: true, location: true, applyUrl: true, source: true } },
        events: { select: { type: true, at: true, note: true }, orderBy: { at: "asc" } },
        documents: {
          select: { kind: true, version: true, content: true, factCheck: true, editedByStudent: true, createdAt: true },
          orderBy: [{ kind: "asc" }, { version: "asc" }],
        },
      },
    }),
    db.jobMatch.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        score: true,
        reasons: true,
        gaps: true,
        explanation: true,
        createdAt: true,
        jobListing: { select: { title: true, company: true, location: true } },
      },
    }),
    db.usageRecord.findMany({
      select: { day: true, aiCalls: true, pdfs: true, searches: true },
      orderBy: { day: "asc" },
    }),
    db.aiRun.findMany({
      select: { task: true, model: true, inputTokens: true, outputTokens: true, outcome: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Recorded before reading the log, so the export includes itself.
  await recordAudit(db, "EXPORT", options.ipHash ?? null);
  const auditLog = await db.auditLog.findMany({ select: { action: true, at: true }, orderBy: { at: "asc" } });

  return {
    format: EXPORT_FORMAT,
    exportedAt: (options.now ?? new Date()).toISOString(),
    account: user,
    profile: profile.version === 0 ? null : profile,
    jobPreferences: preferences,
    resumeUploads: resumeFiles,
    applications,
    jobMatches,
    usage,
    aiCalls: aiRuns,
    auditLog,
  };
}

export type AccountExport = Awaited<ReturnType<typeof exportAccount>>;

/** Case-insensitive email check for the delete confirmation. */
export function confirmsEmail(typed: string, email: string | null | undefined): boolean {
  return Boolean(email) && typed.trim().toLowerCase() === email!.trim().toLowerCase();
}

/**
 * Deletes the account: first every stored file under users/<id>/, then the user row, which
 * cascades to all their data and sessions. Files go first so that a storage failure leaves the
 * account intact (and the student can try again) instead of leaving orphaned files behind.
 *
 * The audit log rows are deleted with the account; a structured log line with a keyed hash of the
 * id (never the email) records that a deletion happened.
 */
export async function deleteAccount(
  userId: string,
  deps: { storage: FileStorage; hashSecret: string },
): Promise<void> {
  const log = getLogger().child({ op: "account.delete" });
  const userHash = createHmac("sha256", deps.hashSecret).update(`user:${userId}`).digest("hex").slice(0, 32);
  try {
    await deps.storage.deleteUserFiles(userId);
  } catch (error) {
    log.error({ userHash, errName: (error as Error).name }, "could not delete stored files");
    throw new UserFacingError(
      "DELETE_FAILED",
      "We couldn't delete your files just now, so nothing was deleted. Please try again in a minute.",
      503,
    );
  }
  const deleted = await deleteUserCascade(userId);
  log.info({ userHash, deleted }, "account deleted");
}

import "server-only";

import path from "node:path";

import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { runAsUser } from "@/lib/owner/context";
import { currentUserId } from "@/lib/owner/current";
import { systemPrisma } from "@/lib/prisma";

/**
 * Background work for every student (Pathfinder: private accounts). Schedulers and sweeps used to
 * act for the single owner; now each run goes through the students one at a time, acting as each
 * in turn, so their settings, data and folders are their own. One student's failure is logged
 * and doesn't stop the others.
 */
export async function forEachStudent(label: string, fn: (userId: string) => Promise<unknown>): Promise<void> {
  const students = await systemPrisma.user.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  for (const { id } of students) {
    try {
      await runAsUser(id, () => fn(id));
    } catch (error) {
      logServerError(`${label} (student ${id})`, error);
    }
  }
}

/** Where every student's folders live, inside DOSSIER_DATA_DIR. */
export const studentsRoot = () => path.join(env.DOSSIER_DATA_DIR, "students");

/** A folder of the current student's, e.g. their backups: DOSSIER_DATA_DIR/students/<id>/backups. */
export async function studentDir(name: string): Promise<string> {
  const userId = await currentUserId();
  // Ids are cuids; refuse anything that could step outside the folder.
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("Unexpected student id");
  return path.join(studentsRoot(), userId, name);
}

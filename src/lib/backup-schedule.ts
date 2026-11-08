import "server-only";

import { stat, unlink } from "node:fs/promises";
import path from "node:path";

import { backupsDir, listBackups, writeBackup } from "@/lib/backups";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { managedMode } from "@/lib/managed";
import { forEachStudent } from "@/lib/owner/students";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Nightly backups (E10-7, SET-10): while "Nightly backups" is on, an export
// is written at 03:00 server time, and backups older than
// DOSSIER_BACKUP_RETENTION_DAYS are removed. A plain timer in this process,
// so it's only safe with a single instance of the app (E12-5).
//
// Pathfinder (P0 task 5): in managed mode they don't run. The server backs up the whole database
// every night (deploy/lightsail/setup.sh), and a full export per student per night would fill the
// disk at thousands of students. Students take their own copy with Export in Settings → Your data.

const HOUR = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The next 03:00 in the server's time zone after `now`. */
export function nextRun(now: Date): Date {
  const next = new Date(now);
  next.setHours(HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

/** Deletes backups older than the retention; returns how many went. */
export async function pruneBackups(now: Date, days = env.DOSSIER_BACKUP_RETENTION_DAYS): Promise<number> {
  const cutoff = now.getTime() - days * DAY_MS;
  const old = (await listBackups()).filter((backup) => backup.modified.getTime() < cutoff);
  const dir = await backupsDir();
  await Promise.all(old.map((backup) => unlink(path.join(dir, backup.name)).catch(() => {})));
  return old.length;
}

/**
 * One night's run: a backup if they're on, then tidying up. A failure is
 * kept in Settings, so the row can show it, and cleared by the next success.
 */
export async function runNightlyBackup(now = new Date()): Promise<"written" | "off"> {
  if (managedMode() || !(await loadSettings()).nightlyBackup) return "off";
  try {
    await writeBackup("nightly", now);
    await pruneBackups(now);
    await saveSettings({ backupProblem: null });
    return "written";
  } catch (error) {
    logServerError("nightly backup", error);
    await saveSettings({ backupProblem: error instanceof Error ? error.message : "The backup couldn't be written." }).catch(() => {});
    throw error;
  }
}

/** When the newest nightly backup was written, if any. */
export async function lastNightlyBackup(): Promise<Date | null> {
  const [latest] = (await listBackups()).filter((backup) => backup.name.startsWith("dossier-backup-nightly-"));
  if (!latest) return null;
  return (await stat(path.join(await backupsDir(), latest.name)).catch(() => null))?.mtime ?? null;
}

const globalForSchedule = globalThis as unknown as { backupTimer?: ReturnType<typeof setTimeout> };

/** Starts the nightly timer, once per process (dev reloads keep the one they have). */
export function startBackupSchedule(): void {
  if (globalForSchedule.backupTimer || managedMode()) return;
  const schedule = () => {
    const now = new Date();
    globalForSchedule.backupTimer = setTimeout(() => {
      // Each student whose nightly backups are on (Pathfinder: private accounts).
      void forEachStudent("nightly backup", () => runNightlyBackup())
        .catch(() => {})
        .finally(schedule);
    }, nextRun(now).getTime() - now.getTime());
    // Don't keep the process alive just for this.
    globalForSchedule.backupTimer.unref?.();
  };
  schedule();
}

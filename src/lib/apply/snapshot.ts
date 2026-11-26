import { z } from "zod";

// Pathfinder (Phase 3): when an application stops short of applied (it needs the student, went
// quiet after Submit, or couldn't be filled), the extension sends what the job page said: its
// address, its heading, the error messages it showed, and the labels of required questions left
// empty. Never anything typed into the form. Shown on Auto-apply beside the reason; deleted after
// SNAPSHOT_DAYS.

export const SNAPSHOT_DAYS = 30;

export const snapshotSchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(200),
  messages: z.array(z.string().max(300)).max(8),
  unfilled: z.array(z.string().max(150)).max(10),
});
export type Snapshot = z.output<typeof snapshotSchema>;

/** A stored snapshot, if it reads and isn't past keeping; its address only when it's a web page. */
export function snapshotOf(stored: unknown, at: Date | null, now: Date = new Date()): (Snapshot & { at: string }) | null {
  if (!at || now.getTime() - at.getTime() > SNAPSHOT_DAYS * 86_400_000) return null;
  const parsed = snapshotSchema.safeParse(stored);
  if (!parsed.success) return null;
  const { url, title, messages, unfilled } = parsed.data;
  if (!title.trim() && messages.length === 0 && unfilled.length === 0) return null;
  return { url: /^https?:\/\//i.test(url) ? url : "", title: title.trim(), messages, unfilled, at: at.toISOString() };
}

/** When snapshots stop being kept, from `now`. */
export const snapshotCutoff = (now: Date = new Date()) => new Date(now.getTime() - SNAPSHOT_DAYS * 86_400_000);

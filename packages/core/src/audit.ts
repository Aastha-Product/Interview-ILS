import { createHmac } from "node:crypto";
import type { AuditAction, ScopedDb } from "@pathfinder/db";

/** Keyed hash of an IP address: lets us spot repeats without storing the address. */
export function hashIp(ip: string | null | undefined, secret: string): string | null {
  if (!ip) return null;
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}

export async function recordAudit(
  db: Pick<ScopedDb, "auditLog" | "userId">,
  action: AuditAction,
  ipHash: string | null = null,
): Promise<void> {
  await db.auditLog.create({ data: { userId: db.userId, action, ipHash } });
}

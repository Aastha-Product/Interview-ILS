import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { prisma, systemPrisma } from "@/lib/prisma";

// Pathfinder (auto-apply step 5): connecting a browser's Pathfinder extension to a student. The
// student connects it from Auto-apply → Connect the extension; the page hands the extension a
// token, which it sends with every request. Only the token's hash is stored.

/** 90 days; connecting again gives a new one. */
export const TOKEN_LIFETIME_MS = 90 * 24 * 3600_000;
const PREFIX = "pfx_";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ExtensionTokenView = { id: string; label: string; createdAt: string; lastUsedAt: string | null; expiresAt: string };

/** A new token for the current student; the only time the token itself is seen. */
export async function createExtensionToken(label: string, now = new Date()): Promise<{ id: string; token: string }> {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await prisma.extensionToken.create({
    data: { tokenHash: hashToken(token), label: label.trim().slice(0, 100), expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS) },
    select: { id: true },
  });
  return { id: row.id, token };
}

/** The current student's connected browsers, newest first; disconnected and expired ones left out. */
export async function listExtensionTokens(now = new Date()): Promise<ExtensionTokenView[]> {
  const rows = await prisma.extensionToken.findMany({ where: { revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
  }));
}

/** Disconnects one of the current student's browsers. */
export async function revokeExtensionToken(id: string, now = new Date()): Promise<boolean> {
  const { count } = await prisma.extensionToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
  return count > 0;
}

/** Only touched once a minute at most, so every request isn't a write. */
const TOUCH_EVERY_MS = 60_000;

/**
 * The student a token belongs to, or null for a token that's unknown, disconnected or expired.
 * Read without a student (the token is how we learn who it is).
 */
export async function verifyExtensionToken(token: string | undefined | null, now = new Date()): Promise<{ userId: string; tokenId: string } | null> {
  if (!token || !token.startsWith(PREFIX) || token.length > 200) return null;
  const row = await systemPrisma.extensionToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.revokedAt || row.expiresAt <= now) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await systemPrisma.extensionToken.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => {});
  }
  return { userId: row.userId, tokenId: row.id };
}

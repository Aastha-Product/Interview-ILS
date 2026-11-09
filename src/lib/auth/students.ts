import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { FirebaseSignInError, type FirebaseIdentity } from "@/lib/auth/firebase";
import { GoogleSignInError, type GoogleIdentity } from "@/lib/auth/google-sign-in";
import { systemPrisma } from "@/lib/prisma";

/** The column that links a student to the account they sign in with. */
type AccountKey = "googleSub" | "firebaseUid";

/**
 * The student an outside account signs in as (Pathfinder). Matched by the account's stable id;
 * the first time, by the email address (an account made before, e.g. with the trial's access code
 * or the other sign-in), which then links them; else a new student. Returns their id, or null
 * when the address's student can't be handed to this account:
 * - the address isn't verified (`emailVerified` false): anyone can type any address, so it only
 *   ever gets a new student, never one that exists;
 * - the student is linked to a different account of this kind, unless `relink` (a verified
 *   address where one address has one account at a time, as in Firebase: the old account is gone).
 */
async function linkStudent(
  key: AccountKey,
  { id, email, name, emailVerified = true, relink = false }: { id: string; email: string; name: string; emailVerified?: boolean; relink?: boolean },
  db: PrismaClient,
): Promise<string | null> {
  const where = key === "googleSub" ? { googleSub: id } : { firebaseUid: id };
  const linked = await db.user.findUnique({ where, select: { id: true, name: true } });
  if (linked) {
    if (!linked.name && name) await db.user.update({ where: { id: linked.id }, data: { name } });
    return linked.id;
  }
  const byEmail = await db.user.findUnique({ where: { email }, select: { id: true, name: true, googleSub: true, firebaseUid: true } });
  if (byEmail) {
    if (!emailVerified) return null;
    if (byEmail[key] && !relink) return null;
    await db.user.update({ where: { id: byEmail.id }, data: { [key]: id, ...(!byEmail.name && name ? { name } : {}) } });
    return byEmail.id;
  }
  try {
    const created = await db.user.create({ data: { email, name, [key]: id }, select: { id: true } });
    return created.id;
  } catch (error) {
    // Two first sign-ins at once: the other one made the student.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return linkStudent(key, { id, email, name, emailVerified, relink }, db);
    throw error;
  }
}

/** The student a Google account (the server's own Google sign-in) signs in as. */
export async function studentForGoogle(identity: GoogleIdentity, db: PrismaClient = systemPrisma): Promise<string> {
  const id = await linkStudent("googleSub", { id: identity.sub, email: identity.email, name: identity.name }, db);
  // Someone else's Google account already owns this address's student.
  if (!id) throw new GoogleSignInError("failed");
  return id;
}

/**
 * The student a Firebase account signs in as. Students go in straight after signing up, without
 * verifying their address first (the owner's choice, 9 November 2026), so an unverified address
 * only ever gets its own new student. A verified one (Google, or a confirmed email) may take over
 * its address's student from an older Firebase account: Firebase keeps one account per address,
 * so that account no longer has it.
 */
export async function studentForFirebase(identity: FirebaseIdentity, db: PrismaClient = systemPrisma): Promise<string> {
  if (!identity.email) throw new FirebaseSignInError("unverified");
  const id = await linkStudent(
    "firebaseUid",
    { id: identity.uid, email: identity.email, name: identity.name, emailVerified: identity.emailVerified, relink: identity.emailVerified },
    db,
  );
  if (!id) throw new FirebaseSignInError("taken");
  return id;
}

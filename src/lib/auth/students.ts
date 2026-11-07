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
 * the first time, by the verified email address (an account made before, e.g. with the trial's
 * access code or the other sign-in), which then links them; else a new student. Returns their
 * id, or null when the address's student is already linked to a different account of this kind:
 * that one isn't handed over.
 */
async function linkStudent(
  key: AccountKey,
  { id, email, name }: { id: string; email: string; name: string },
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
    if (byEmail[key]) return null;
    await db.user.update({ where: { id: byEmail.id }, data: { [key]: id, ...(!byEmail.name && name ? { name } : {}) } });
    return byEmail.id;
  }
  try {
    const created = await db.user.create({ data: { email, name, [key]: id }, select: { id: true } });
    return created.id;
  } catch (error) {
    // Two first sign-ins at once: the other one made the student.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return linkStudent(key, { id, email, name }, db);
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

/** The student a Firebase account signs in as; its email address must be verified. */
export async function studentForFirebase(identity: FirebaseIdentity, db: PrismaClient = systemPrisma): Promise<string> {
  if (!identity.email || !identity.emailVerified) throw new FirebaseSignInError("unverified");
  const id = await linkStudent("firebaseUid", { id: identity.uid, email: identity.email, name: identity.name }, db);
  if (!id) throw new FirebaseSignInError("taken");
  return id;
}

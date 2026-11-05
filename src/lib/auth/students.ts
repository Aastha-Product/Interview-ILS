import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { GoogleSignInError, type GoogleIdentity } from "@/lib/auth/google-sign-in";
import { systemPrisma } from "@/lib/prisma";

/**
 * The student a Google account signs in as (Pathfinder). Matched by Google's stable account id;
 * the first time, by the verified email address (an account made before Google sign-in, e.g.
 * with the trial's access code), which then links them; else a new student. Returns their id.
 */
export async function studentForGoogle(identity: GoogleIdentity, db: PrismaClient = systemPrisma): Promise<string> {
  const linked = await db.user.findUnique({ where: { googleSub: identity.sub }, select: { id: true, name: true } });
  if (linked) {
    if (!linked.name && identity.name) await db.user.update({ where: { id: linked.id }, data: { name: identity.name } });
    return linked.id;
  }
  const byEmail = await db.user.findUnique({ where: { email: identity.email }, select: { id: true, name: true, googleSub: true } });
  if (byEmail) {
    // Someone else's Google account already owns this address's student: don't hand it over.
    if (byEmail.googleSub) throw new GoogleSignInError("failed");
    await db.user.update({
      where: { id: byEmail.id },
      data: { googleSub: identity.sub, ...(!byEmail.name && identity.name ? { name: identity.name } : {}) },
    });
    return byEmail.id;
  }
  try {
    const created = await db.user.create({ data: { email: identity.email, googleSub: identity.sub, name: identity.name }, select: { id: true } });
    return created.id;
  } catch (error) {
    // Two first sign-ins at once: the other one made the student.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return studentForGoogle(identity, db);
    throw error;
  }
}

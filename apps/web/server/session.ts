import "server-only";
import { scopedDb, type ScopedDb } from "@pathfinder/db";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export interface CurrentUser {
  id: string;
  email: string | null;
  name: string | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email ?? null, name: session.user.name ?? null };
}

/** For pages: the signed-in user and their scoped database, or a redirect to sign-in. */
export async function requireUser(): Promise<{ user: CurrentUser; db: ScopedDb }> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return { user, db: scopedDb(user.id) };
}

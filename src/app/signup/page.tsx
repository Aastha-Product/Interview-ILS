import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AuthShell } from "@/app/login/auth-shell";
import { FirebaseAuth } from "@/app/login/firebase-auth";
import { firebaseConfig } from "@/lib/auth/firebase";
import { signInMode } from "@/lib/auth/google-sign-in";
import { HOME_PATH } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create your account" };

/** Signing up with Firebase (Pathfinder). With another way of signing in, there's no such page. */
export default async function SignUpPage({ searchParams }: PageProps<"/signup">) {
  if (await getSession()) redirect(HOME_PATH);
  const config = signInMode() === "firebase" ? firebaseConfig() : null;
  if (!config) notFound();
  const { next } = await searchParams;
  return (
    <AuthShell>
      <FirebaseAuth config={config} mode="sign-up" next={typeof next === "string" ? next : undefined} />
    </AuthShell>
  );
}

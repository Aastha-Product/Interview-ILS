import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuthShell } from "@/app/login/auth-shell";
import { FirebaseAuth } from "@/app/login/firebase-auth";
import { firebaseConfig } from "@/lib/auth/firebase";
import { signInMode } from "@/lib/auth/google-sign-in";

export const metadata: Metadata = { title: "Reset your password" };

/**
 * Resetting a password with Firebase (Pathfinder): Firebase emails the link and hosts the page
 * that sets the new one. Signed-in students come here from Settings to change their password.
 * With another way of signing in, there's no such page.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const config = signInMode() === "firebase" ? firebaseConfig() : null;
  if (!config) notFound();
  const { next } = await searchParams;
  return (
    <AuthShell>
      <FirebaseAuth config={config} mode="reset" next={typeof next === "string" ? next : undefined} />
    </AuthShell>
  );
}

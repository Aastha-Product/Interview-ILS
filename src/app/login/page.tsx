import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { firebaseConfig } from "@/lib/auth/firebase";
import { signInMode } from "@/lib/auth/google-sign-in";
import { HOME_PATH } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";

import { AuthShell } from "./auth-shell";
import { FirebaseAuth } from "./firebase-auth";
import { GoogleSignInForm } from "./google-sign-in-form";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign-in, outside the app shell (PRD AUTH-1, AUTH-8). Pathfinder: with Firebase (email and
 * password, or Google), with the server's own Google sign-in, or, for trials, an email and the
 * shared access code (PATHFINDER_SIGN_IN).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect(HOME_PATH);
  const { next, error } = await searchParams;
  const mode = signInMode();
  const nextPath = typeof next === "string" ? next : undefined;
  const firebase = mode === "firebase" ? firebaseConfig() : null;

  if (firebase) {
    return (
      <AuthShell>
        <FirebaseAuth config={firebase} mode="sign-in" next={nextPath} />
      </AuthShell>
    );
  }
  return (
    <AuthShell
      footnote={
        mode === "google" ? (
          <>Google only tells this server your name and email address. Your resume stays private to you.</>
        ) : (
          <>
            This server is in trial mode: the access code is set on the server, as a hash in{" "}
            <code className="font-mono text-label">DOSSIER_PASSWORD</code>, and anyone who has it can sign in.
          </>
        )
      }
    >
      {mode === "google" ? (
        <GoogleSignInForm next={nextPath} error={typeof error === "string" ? error : undefined} />
      ) : (
        <LoginForm next={nextPath} />
      )}
    </AuthShell>
  );
}

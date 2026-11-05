import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { signInMode } from "@/lib/auth/google-sign-in";
import { getSession } from "@/lib/auth/session";

import { GoogleSignInForm } from "./google-sign-in-form";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign-in, outside the app shell (PRD AUTH-1, AUTH-8). Pathfinder: with Google, or, for trials,
 * an email and the shared access code (PATHFINDER_SIGN_IN).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next, error } = await searchParams;
  const withGoogle = signInMode() === "google";
  const nextPath = typeof next === "string" ? next : undefined;

  return (
    // The form on the panel's colour, a warm wash on the right.
    <main className="grid min-h-screen bg-surface min-[960px]:grid-cols-2">
      <div className="flex items-center justify-center px-8 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-8">
        <div className="flex flex-col items-start gap-2">
          <BrandMark className="size-10" />
          <div className="flex flex-col">
            <div className="font-serif text-[30px] font-medium tracking-[-0.01em]">Dossier</div>
            <div className="text-sm text-muted">Your job search, on your server</div>
          </div>
        </div>
        {withGoogle ? (
          <GoogleSignInForm next={nextPath} error={typeof error === "string" ? error : undefined} />
        ) : (
          <LoginForm next={nextPath} />
        )}
        <p className="text-meta leading-[1.6] text-pretty text-muted">
          {withGoogle ? (
            <>Google only tells this server your name and email address. Your job search stays private to you.</>
          ) : (
            <>
              This server is in trial mode: the access code is set on the server, as a hash in{" "}
              <code className="font-mono text-label">DOSSIER_PASSWORD</code>, and anyone who has it can sign in.
            </>
          )}
        </p>
      </div>
      </div>
      <div
        aria-hidden="true"
        className="hidden bg-[linear-gradient(to_left,color-mix(in_srgb,var(--color-ink)_9%,transparent)_0%,transparent_65%)] min-[960px]:grid min-[960px]:place-items-center"
      >
        <BrandMark className="size-40 opacity-90 shadow-dialog rounded-[36px]" />
      </div>
    </main>
  );
}

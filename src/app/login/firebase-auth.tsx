"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import type { Auth, User } from "firebase/auth";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/cn";

import { signInWithFirebase } from "./actions";
import { firebaseErrorMessage, MIN_PASSWORD } from "./firebase-errors";

// Pathfinder: signing up, signing in and resetting a password with Firebase Authentication. The
// browser talks to Firebase; once Firebase has signed the student in, the ID token goes to the
// server once (signInWithFirebase), which starts this site's own session. Firebase keeps
// nothing in the browser: its session is in memory only, and gone when the page is.

/** The Firebase project, from the server's settings. None of it is secret. */
export type FirebaseClientConfig = { apiKey: string; authDomain: string; projectId: string; emulatorUrl: string | null };

export type FirebaseAuthMode = "sign-in" | "sign-up" | "reset";

let started: Promise<Auth> | undefined;

/** Firebase Auth, loaded when first needed, so the page shows before its code arrives. */
function firebaseAuth(config: FirebaseClientConfig): Promise<Auth> {
  started ??= (async () => {
    const [{ getApps, initializeApp }, { browserPopupRedirectResolver, connectAuthEmulator, inMemoryPersistence, initializeAuth }] =
      await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = getApps()[0] ?? initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId });
    const auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
    if (config.emulatorUrl) connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
    return auth;
  })();
  return started;
}

const COPY: Record<FirebaseAuthMode, { title: string; intro: string; submit: string; busy: string }> = {
  "sign-in": {
    title: "Welcome back",
    intro: "Sign in to upload your resume and see your analyses.",
    submit: "Sign in",
    busy: "Signing in…",
  },
  "sign-up": {
    title: "Create your free account",
    intro: "Upload your resume and get an instant analysis: what works, what to improve and what's missing. Your resume stays private to you.",
    submit: "Create account",
    busy: "Creating your account…",
  },
  reset: {
    title: "Reset your password",
    intro: "Enter the email address you signed up with, and we'll send you a link to choose a new password.",
    submit: "Send reset link",
    busy: "Sending…",
  },
};

/**
 * The sign-in, sign-up and password reset forms. After signing up, the student verifies their
 * email address before they can sign in: free analyses are per account, so accounts need a real
 * inbox.
 */
export function FirebaseAuth({ config, mode, next }: { config: FirebaseClientConfig; mode: FirebaseAuthMode; next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Signed up or signed in, but the email address isn't verified yet. */
  const [unverified, setUnverified] = useState<string | null>(null);
  const user = useRef<User | null>(null);
  const [pending, startTransition] = useTransition();
  const copy = COPY[mode];
  const query = next ? `?next=${encodeURIComponent(next)}` : "";

  function fail(problem: unknown) {
    const message = typeof problem === "string" ? problem : firebaseErrorMessage(problem);
    if (message) setError(message);
  }

  /** Hands Firebase's ID token to the server, which starts the session. */
  async function finish(signedIn: User) {
    const result = await signInWithFirebase({ idToken: await signedIn.getIdToken(true), remember, next });
    if (!result.ok) return fail(result.error);
    toastResult(result);
    router.replace(result.data.redirectTo);
  }

  async function needsVerifying(signedIn: User) {
    user.current = signedIn;
    setUnverified(signedIn.email ?? email.trim());
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setNotice(null);
    if (mode === "sign-up" && !name.trim()) return fail("Enter your name.");
    if (!email.trim()) return fail("Enter your email address.");
    if (mode !== "reset" && !password) return fail("Enter your password.");
    if (mode === "sign-up" && password.length < MIN_PASSWORD) return fail(`Choose a password of at least ${MIN_PASSWORD} characters.`);

    startTransition(async () => {
      try {
        const auth = await firebaseAuth(config);
        const firebase = await import("firebase/auth");
        if (mode === "reset") {
          try {
            await firebase.sendPasswordResetEmail(auth, email.trim());
          } catch (problem) {
            // Whether an account exists isn't for anyone who types an address to find out.
            const code = typeof problem === "object" && problem !== null && "code" in problem ? String(problem.code) : "";
            if (code !== "auth/user-not-found") throw problem;
          }
          setNotice(`If there's an account for ${email.trim()}, we've sent it a link to reset the password. Check your inbox and spam folder.`);
          return;
        }
        if (mode === "sign-up") {
          const created = await firebase.createUserWithEmailAndPassword(auth, email.trim(), password);
          await firebase.updateProfile(created.user, { displayName: name.trim() });
          await firebase.sendEmailVerification(created.user);
          return needsVerifying(created.user);
        }
        const { user: signedIn } = await firebase.signInWithEmailAndPassword(auth, email.trim(), password);
        if (!signedIn.emailVerified) return needsVerifying(signedIn);
        await finish(signedIn);
      } catch (problem) {
        fail(problem);
      }
    });
  }

  function withGoogle() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const auth = await firebaseAuth(config);
        const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const { user: signedIn } = await signInWithPopup(auth, provider);
        await finish(signedIn);
      } catch (problem) {
        fail(problem);
      }
    });
  }

  /** "I've verified it": Firebase is asked again, and the student goes in once it agrees. */
  function checkVerified() {
    const signedIn = user.current;
    if (!signedIn || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await signedIn.reload();
        if (!signedIn.emailVerified) return fail("Your email address isn't verified yet. Open the link in the email we sent, then try again.");
        await finish(signedIn);
      } catch (problem) {
        fail(problem);
      }
    });
  }

  function resend() {
    const signedIn = user.current;
    if (!signedIn || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const { sendEmailVerification } = await import("firebase/auth");
        await sendEmailVerification(signedIn);
        setNotice("We've sent the email again.");
      } catch (problem) {
        fail(problem);
      }
    });
  }

  if (unverified) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">Check your inbox</h1>
          <p className="text-sm text-pretty text-muted">
            We&apos;ve sent a link to <span className="font-medium text-ink">{unverified}</span>. Open it to verify your email address, then
            come back here. If it isn&apos;t there, look in your spam folder.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-meta text-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-meta text-muted">
            {notice}
          </p>
        )}
        <Button size="lg" onClick={checkVerified} disabled={pending}>
          {pending ? "Checking…" : "I've verified my email"}
        </Button>
        <Button variant="secondary" size="lg" onClick={resend} disabled={pending}>
          Send the email again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">{copy.title}</h1>
        <p className="text-sm text-pretty text-muted">{copy.intro}</p>
      </div>

      {mode !== "reset" && (
        <>
          <Button variant="secondary" size="lg" onClick={withGoogle} disabled={pending}>
            <GoogleLogo />
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-meta text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            or with your email
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {mode === "sign-up" && (
          <Field label="Your name" id="name">
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={cn(controlClassName, "h-10 px-3")}
            />
          </Field>
        )}
        <Field label="Email" id="email">
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={cn(controlClassName, "h-10 px-3")}
          />
        </Field>
        {mode !== "reset" && (
          <div className="flex flex-col gap-[7px]">
            <div className="flex justify-between text-label text-muted">
              <label htmlFor="password">Password</label>
              <button
                type="button"
                aria-label={visible ? "Hide password" : "Show password"}
                aria-controls="password"
                onClick={() => setVisible((shown) => !shown)}
                className="underline underline-offset-3 hover:text-ink"
              >
                {visible ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="password"
              type={visible ? "text" : "password"}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={mode === "sign-up" ? "password-hint" : undefined}
              className={cn(controlClassName, "h-10 px-3")}
            />
            {mode === "sign-up" && (
              <p id="password-hint" className="text-meta text-muted">
                At least {MIN_PASSWORD} characters.
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-meta text-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-meta text-pretty text-ink">
            {notice}
          </p>
        )}

        {mode !== "reset" && (
          <Checkbox label="Keep me signed in for 30 days" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        )}

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? copy.busy : copy.submit}
        </Button>
      </form>

      <div className="flex flex-col gap-2 text-sm text-muted">
        {mode === "sign-in" && (
          <>
            <Link href={`/reset-password${query}`} className="font-medium text-ink underline underline-offset-2">
              Forgot your password?
            </Link>
            <p>
              New here?{" "}
              <Link href={`/signup${query}`} className="font-medium text-ink underline underline-offset-2">
                Create a free account
              </Link>
            </p>
          </>
        )}
        {mode !== "sign-in" && (
          <p>
            {mode === "sign-up" ? "Already have an account? " : "Remembered it? "}
            <Link href={`/login${query}`} className="font-medium text-ink underline underline-offset-2">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id} className="text-label text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Google's "G", as its sign-in guidelines ask for next to "Continue with Google". */
function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px]">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

import { env, type Env } from "@/lib/env";
import { googleUrl } from "@/lib/google/endpoints";
import { deriveKey } from "@/lib/keys";

// Pathfinder: students sign in with their Google account (OpenID Connect, the authorization code
// flow with PKCE). The server's own OAuth client (DOSSIER_GOOGLE_CLIENT_*) is used: there are no
// student settings before sign-in. What the start of the flow needs at the end (the state, the
// PKCE verifier, the nonce, where to go next) travels in a short-lived encrypted cookie, so the
// callback only works in the browser that started it.

export const SIGN_IN_PATH = "/api/auth/google";
export const SIGN_IN_CALLBACK_PATH = "/api/auth/google/callback";
export const SIGN_IN_COOKIE = "pathfinder_google_sign_in";
/** How long a student has to finish at Google's end. */
export const SIGN_IN_TTL_SECONDS = 10 * 60;

/** Why a Google sign-in didn't work, as /login?error=… shows it. */
export const SIGN_IN_ERRORS = {
  "not-configured": "Google sign-in isn't set up on this server yet.",
  expired: "That sign-in took too long or was started in another browser. Try again.",
  denied: "Google sign-in was cancelled.",
  unverified: "Your Google account's email address isn't verified. Verify it with Google, then try again.",
  failed: "Google sign-in didn't work. Try again.",
} as const;
export type SignInError = keyof typeof SIGN_IN_ERRORS;

export class GoogleSignInError extends Error {
  constructor(readonly kind: SignInError) {
    super(SIGN_IN_ERRORS[kind]);
    this.name = "GoogleSignInError";
  }
}

type SignInEnv = Pick<Env, "DOSSIER_GOOGLE_CLIENT_ID" | "DOSSIER_GOOGLE_CLIENT_SECRET" | "PATHFINDER_SIGN_IN"> &
  Partial<Pick<Env, "PATHFINDER_FIREBASE_API_KEY" | "PATHFINDER_FIREBASE_AUTH_DOMAIN" | "PATHFINDER_FIREBASE_PROJECT_ID">>;

/** The server's OAuth client for sign-in, or null while it isn't set. */
export function signInClient(source: SignInEnv = env): { id: string; secret: string } | null {
  const id = source.DOSSIER_GOOGLE_CLIENT_ID;
  const secret = source.DOSSIER_GOOGLE_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/**
 * How students sign in: PATHFINDER_SIGN_IN, else Firebase once its project is set, else Google
 * once its client is set, else the access code.
 */
export function signInMode(source: SignInEnv = env): "firebase" | "google" | "code" {
  if (source.PATHFINDER_SIGN_IN) return source.PATHFINDER_SIGN_IN;
  if (source.PATHFINDER_FIREBASE_API_KEY && source.PATHFINDER_FIREBASE_AUTH_DOMAIN && source.PATHFINDER_FIREBASE_PROJECT_ID) return "firebase";
  return signInClient(source) ? "google" : "code";
}

/**
 * Why a production server mustn't start (Pathfinder, QA C-3): with neither Firebase nor Google
 * set up, sign-in falls back to the shared access code, which lets anyone who has it in as any
 * email. That has to be chosen on purpose (PATHFINDER_SIGN_IN=code, for a trial), never reached
 * by a missing setting. Null when there's nothing wrong.
 */
export function accessCodeProblem(source: SignInEnv = env, nodeEnv = process.env.NODE_ENV): string | null {
  if (nodeEnv !== "production" || signInMode(source) !== "code" || source.PATHFINDER_SIGN_IN === "code") return null;
  return (
    "Sign-in isn't set up: without the Firebase project (PATHFINDER_FIREBASE_*) or a Google client (DOSSIER_GOOGLE_CLIENT_ID and " +
    "DOSSIER_GOOGLE_CLIENT_SECRET), students would sign in with the shared access code, as any email. Set one of them up, or set " +
    "PATHFINDER_SIGN_IN=code to run a trial on the access code on purpose."
  );
}

/** Where Google sends the browser back to: DOSSIER_PUBLIC_URL, else the address in use. */
export function signInRedirectUri(origin: string): string {
  return `${env.DOSSIER_PUBLIC_URL ?? origin}${SIGN_IN_CALLBACK_PATH}`;
}

const random = () => randomBytes(32).toString("base64url");
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

const pendingSchema = z.object({
  state: z.string().min(20),
  verifier: z.string().min(43),
  nonce: z.string().min(20),
  next: z.string(),
  remember: z.boolean(),
});
export type PendingSignIn = z.infer<typeof pendingSchema>;

/** Starts a sign-in: Google's consent page to send the browser to, and the cookie that must come back with it. */
export async function beginSignIn({
  clientId,
  redirect,
  next,
  remember,
  secret,
}: {
  clientId: string;
  redirect: string;
  next: string;
  remember: boolean;
  secret?: string;
}): Promise<{ url: string; cookie: string; pending: PendingSignIn }> {
  const pending: PendingSignIn = { state: random(), verifier: random(), nonce: random(), next, remember };
  const cookie = await new EncryptJWT(pending)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SIGN_IN_TTL_SECONDS}s`)
    .encrypt(deriveKey("google-sign-in", secret));
  const url = new URL(googleUrl("accounts", "/o/oauth2/v2/auth"));
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid email profile",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: challengeOf(pending.verifier),
    code_challenge_method: "S256",
    // Lets a student with several Google accounts pick one.
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), cookie, pending };
}

/** The sign-in this browser started, if its cookie is genuine, unexpired and matches Google's state. */
export async function openPendingSignIn(
  cookie: string | undefined,
  state: string | null,
  { secret, now }: { secret?: string; now?: Date } = {},
): Promise<PendingSignIn | null> {
  if (!cookie || !state) return null;
  try {
    const { payload } = await jwtDecrypt(cookie, deriveKey("google-sign-in", secret), { currentDate: now });
    const pending = pendingSchema.safeParse(payload);
    return pending.success && pending.data.state === state ? pending.data : null;
  } catch {
    return null;
  }
}

const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  sub: z.string().min(1),
  nonce: z.string().optional(),
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
});

export type GoogleIdentity = { sub: string; email: string; name: string };

/**
 * Who signed in, from the ID token. It came straight from Google's token endpoint over TLS, so
 * its signature needn't be checked (OpenID Connect Core §3.1.3.7); the claims still are: Google
 * issued it, for this server's client, not expired, for this sign-in (the nonce), with a verified
 * email address.
 */
export function identityFromIdToken(
  idToken: string | undefined,
  { clientId, nonce, now = new Date() }: { clientId: string; nonce: string; now?: Date },
): GoogleIdentity {
  const payload = idToken?.split(".")[1];
  if (!payload) throw new GoogleSignInError("failed");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new GoogleSignInError("failed");
  }
  const parsed = claimsSchema.safeParse(raw);
  if (!parsed.success) throw new GoogleSignInError("failed");
  const claims = parsed.data;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!GOOGLE_ISSUERS.has(claims.iss) || !audiences.includes(clientId)) throw new GoogleSignInError("failed");
  if (claims.exp * 1000 <= now.getTime() || claims.nonce !== nonce) throw new GoogleSignInError("expired");
  if (!claims.email || claims.email_verified !== true) throw new GoogleSignInError("unverified");
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: claims.name?.trim() ?? "" };
}

const tokenSchema = z.object({ id_token: z.string() });

/** Trades the code from the callback, with the PKCE verifier, for the student's identity. */
export async function finishSignIn({
  code,
  pending,
  client,
  redirect,
  fetchImpl = fetch,
}: {
  code: string;
  pending: PendingSignIn;
  client: { id: string; secret: string };
  redirect: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleIdentity> {
  let response: Response;
  try {
    response = await fetchImpl(googleUrl("oauth2", "/token"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: redirect,
        grant_type: "authorization_code",
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new GoogleSignInError("failed");
  }
  const answer = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !answer.success) throw new GoogleSignInError("failed");
  return identityFromIdToken(answer.data.id_token, { clientId: client.id, nonce: pending.nonce });
}

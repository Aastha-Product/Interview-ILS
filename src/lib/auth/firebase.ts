import "server-only";

import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

import { env, type Env } from "@/lib/env";

// Pathfinder: students sign in with Firebase Authentication. The browser signs in at Firebase
// (email and password, or Google) and hands this server the ID token Firebase gave it, once. The
// server checks the token itself, as Firebase documents ("Verify ID tokens using a third-party
// JWT library"): Google's signature, this project as audience and issuer, not expired, a user.
// Then it links the student and starts its own session; Firebase keeps nothing in the browser.

/** The Firebase project, as the browser needs it, or null while it isn't set. */
export type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  /** The Auth emulator's address for local testing (http://127.0.0.1:9099), else null. */
  emulatorUrl: string | null;
};

type FirebaseEnv = Partial<
  Pick<Env, "PATHFINDER_FIREBASE_API_KEY" | "PATHFINDER_FIREBASE_AUTH_DOMAIN" | "PATHFINDER_FIREBASE_PROJECT_ID" | "FIREBASE_AUTH_EMULATOR_HOST">
>;

export function firebaseConfig(source: FirebaseEnv = env): FirebaseConfig | null {
  const apiKey = source.PATHFINDER_FIREBASE_API_KEY;
  const authDomain = source.PATHFINDER_FIREBASE_AUTH_DOMAIN;
  const projectId = source.PATHFINDER_FIREBASE_PROJECT_ID;
  if (!apiKey || !authDomain || !projectId) return null;
  const host = source.FIREBASE_AUTH_EMULATOR_HOST;
  return { apiKey, authDomain, projectId, emulatorUrl: host ? `http://${host}` : null };
}

/** Why a Firebase sign-in didn't work, in words for the sign-in page. */
export const FIREBASE_SIGN_IN_ERRORS = {
  "not-configured": "Sign-in isn't set up on this server yet.",
  invalid: "That sign-in didn't work. Try again.",
  unverified: "This sign-in has no email address. Use your email and a password, or another Google account.",
  taken: "There's already an account with this email address. Sign in with Google, or reset your password.",
  unavailable: "We couldn't reach the sign-in service. Try again in a minute.",
} as const;
export type FirebaseSignInErrorKind = keyof typeof FIREBASE_SIGN_IN_ERRORS;

export class FirebaseSignInError extends Error {
  constructor(readonly kind: FirebaseSignInErrorKind) {
    super(FIREBASE_SIGN_IN_ERRORS[kind]);
    this.name = "FirebaseSignInError";
  }
}

/** Who signed in, as Firebase vouches for it. */
export type FirebaseIdentity = { uid: string; email: string; emailVerified: boolean; name: string };

/** Google's public keys for Firebase ID tokens. */
const GOOGLE_KEYS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let googleKeys: JWTVerifyGetKey | undefined;

const claimsSchema = z.object({
  sub: z.string().min(1).max(128),
  auth_time: z.number(),
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
});

/**
 * Checks a Firebase ID token and returns who it's for. A token is accepted for 10 minutes after
 * it was issued: the browser sends it straight after signing in, so an older one is a replay.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  { projectId, keys, now = new Date() }: { projectId: string; keys?: JWTVerifyGetKey; now?: Date },
): Promise<FirebaseIdentity> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(idToken, keys ?? (googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_KEYS_URL))), {
      algorithms: ["RS256"],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      requiredClaims: ["sub", "iat", "exp", "auth_time"],
      maxTokenAge: "10m",
      currentDate: now,
    }));
  } catch (error) {
    // Google's keys couldn't be fetched: not the student's fault.
    if (error instanceof errors.JWKSTimeout || (error instanceof Error && error.name === "TypeError")) throw new FirebaseSignInError("unavailable");
    throw new FirebaseSignInError("invalid");
  }
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success || claims.data.auth_time * 1000 > now.getTime() + 60_000) throw new FirebaseSignInError("invalid");
  return identityOf(claims.data.sub, claims.data.email, claims.data.email_verified, claims.data.name);
}

const lookupSchema = z.object({
  users: z
    .array(z.object({ localId: z.string().min(1), email: z.string().optional(), emailVerified: z.boolean().optional(), displayName: z.string().optional() }))
    .min(1),
});

/**
 * Who an ID token is for, asked of the Auth emulator (local testing only). The emulator doesn't
 * sign its tokens, so they can't be checked like real ones; it answers for the ones it issued.
 */
export async function lookUpWithEmulator(
  idToken: string,
  { emulatorUrl, apiKey, fetchImpl = fetch }: { emulatorUrl: string; apiKey: string; fetchImpl?: typeof fetch },
): Promise<FirebaseIdentity> {
  let response: Response;
  try {
    response = await fetchImpl(`${emulatorUrl}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new FirebaseSignInError("unavailable");
  }
  const answer = lookupSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !answer.success) throw new FirebaseSignInError("invalid");
  const user = answer.data.users[0];
  return identityOf(user.localId, user.email, user.emailVerified, user.displayName);
}

function identityOf(uid: string, email: string | undefined, verified: boolean | undefined, name: string | undefined): FirebaseIdentity {
  return { uid, email: email?.trim().toLowerCase() ?? "", emailVerified: verified === true, name: name?.trim() ?? "" };
}

/** Who an ID token from the browser is for, by the server's Firebase settings. */
export async function firebaseIdentity(idToken: string, config: FirebaseConfig | null = firebaseConfig()): Promise<FirebaseIdentity> {
  if (!config) throw new FirebaseSignInError("not-configured");
  if (config.emulatorUrl) return lookUpWithEmulator(idToken, { emulatorUrl: config.emulatorUrl, apiKey: config.apiKey });
  return verifyFirebaseIdToken(idToken, { projectId: config.projectId });
}

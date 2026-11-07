import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  beginSignIn,
  finishSignIn,
  GoogleSignInError,
  identityFromIdToken,
  openPendingSignIn,
  signInMode,
} from "./google-sign-in";

const secret = "s".repeat(32);
const clientId = "client-123.apps.googleusercontent.com";
const now = new Date("2026-11-06T10:00:00Z");

/** An ID token as Google's token endpoint returns it; the signature isn't read. */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({
    iss: "https://accounts.google.com",
    aud: clientId,
    exp: now.getTime() / 1000 + 3600,
    sub: "google-sub-1",
    nonce: "n".repeat(43),
    email: "Asha@Example.com",
    email_verified: true,
    name: "Asha Rao",
    ...claims,
  })}.signature`;
}
const check = (claims: Record<string, unknown>) => () => identityFromIdToken(idToken(claims), { clientId, nonce: "n".repeat(43), now });
const kindOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof GoogleSignInError ? error.kind : "other";
  }
  return "none";
};

describe("signInMode (Pathfinder)", () => {
  it("uses Google once the client is set, the access code before, and PATHFINDER_SIGN_IN over both", () => {
    expect(signInMode({ DOSSIER_GOOGLE_CLIENT_ID: "id", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", PATHFINDER_SIGN_IN: undefined })).toBe("google");
    expect(signInMode({ DOSSIER_GOOGLE_CLIENT_ID: "id", DOSSIER_GOOGLE_CLIENT_SECRET: undefined, PATHFINDER_SIGN_IN: undefined })).toBe("code");
    expect(signInMode({ DOSSIER_GOOGLE_CLIENT_ID: "id", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", PATHFINDER_SIGN_IN: "code" })).toBe("code");
    expect(signInMode({ DOSSIER_GOOGLE_CLIENT_ID: undefined, DOSSIER_GOOGLE_CLIENT_SECRET: undefined, PATHFINDER_SIGN_IN: "google" })).toBe("google");
  });

  it("uses Firebase once its project is set, before Google, unless PATHFINDER_SIGN_IN says otherwise", () => {
    const firebase = {
      PATHFINDER_FIREBASE_API_KEY: "key",
      PATHFINDER_FIREBASE_AUTH_DOMAIN: "p.firebaseapp.com",
      PATHFINDER_FIREBASE_PROJECT_ID: "p",
      DOSSIER_GOOGLE_CLIENT_ID: "id",
      DOSSIER_GOOGLE_CLIENT_SECRET: "secret",
      PATHFINDER_SIGN_IN: undefined,
    };
    expect(signInMode(firebase)).toBe("firebase");
    expect(signInMode({ ...firebase, PATHFINDER_FIREBASE_PROJECT_ID: undefined })).toBe("google");
    expect(signInMode({ ...firebase, PATHFINDER_SIGN_IN: "code" })).toBe("code");
  });
});

describe("starting a Google sign-in", () => {
  it("asks Google for the student's identity only, with PKCE, a state and a nonce", async () => {
    const { url, pending } = await beginSignIn({ clientId, redirect: "https://app.example/api/auth/google/callback", next: "/jobs", remember: true, secret });
    const params = new URL(url).searchParams;
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(params.get("client_id")).toBe(clientId);
    expect(params.get("redirect_uri")).toBe("https://app.example/api/auth/google/callback");
    expect(params.get("scope")).toBe("openid email profile");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("state")).toBe(pending.state);
    expect(params.get("nonce")).toBe(pending.nonce);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBe(createHash("sha256").update(pending.verifier).digest("base64url"));
    // Not offline: sign-in needs no refresh token.
    expect(params.has("access_type")).toBe(false);
    expect(url).not.toContain(pending.verifier);
  });

  it("only finishes in the browser that started it, with Google's state, within ten minutes", async () => {
    const { cookie, pending } = await beginSignIn({ clientId, redirect: "r", next: "/", remember: false, secret });
    expect(await openPendingSignIn(cookie, pending.state, { secret })).toEqual(pending);
    expect(await openPendingSignIn(cookie, "someone-elses-state-xxxxxxxx", { secret })).toBeNull();
    expect(await openPendingSignIn(undefined, pending.state, { secret })).toBeNull();
    expect(await openPendingSignIn(cookie, null, { secret })).toBeNull();
    expect(await openPendingSignIn(cookie, pending.state, { secret: "t".repeat(32) })).toBeNull();
    expect(await openPendingSignIn(`${cookie.slice(0, -2)}xx`, pending.state, { secret })).toBeNull();
    expect(await openPendingSignIn(cookie, pending.state, { secret, now: new Date(Date.now() + 11 * 60_000) })).toBeNull();
    // The cookie is encrypted: the verifier can't be read from it.
    expect(cookie).not.toContain(pending.verifier);
  });
});

describe("the ID token", () => {
  it("names the student by Google's account id, with the email in lower case", () => {
    expect(check({})()).toEqual({ sub: "google-sub-1", email: "asha@example.com", name: "Asha Rao" });
    expect(check({ iss: "accounts.google.com", aud: [clientId, "other"] })().sub).toBe("google-sub-1");
  });

  it("refuses one from someone else, for another app, expired, from another sign-in or without a verified email", () => {
    expect(kindOf(check({ iss: "https://evil.example" }))).toBe("failed");
    expect(kindOf(check({ aud: "another-client" }))).toBe("failed");
    expect(kindOf(check({ exp: now.getTime() / 1000 - 1 }))).toBe("expired");
    expect(kindOf(check({ nonce: "m".repeat(43) }))).toBe("expired");
    expect(kindOf(check({ nonce: undefined }))).toBe("expired");
    expect(kindOf(check({ email_verified: false }))).toBe("unverified");
    expect(kindOf(check({ email: undefined }))).toBe("unverified");
    expect(kindOf(check({ sub: "" }))).toBe("failed");
    expect(kindOf(() => identityFromIdToken("not-a-token", { clientId, nonce: "n", now }))).toBe("failed");
    expect(kindOf(() => identityFromIdToken(undefined, { clientId, nonce: "n", now }))).toBe("failed");
  });
});

describe("finishing a Google sign-in", () => {
  it("trades the code with the PKCE verifier and reads who it is", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    const pending = { state: "s".repeat(43), verifier: "v".repeat(43), nonce: "n".repeat(43), next: "/", remember: false };
    const fetchImpl = vi.fn(async () => Response.json({ id_token: idToken({}), access_token: "a", expires_in: 3600 }));
    const identity = await finishSignIn({ code: "the-code", pending, client: { id: clientId, secret: "client-secret" }, redirect: "r", fetchImpl });
    vi.useRealTimers();
    expect(identity.sub).toBe("google-sub-1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(Object.fromEntries(body)).toMatchObject({ code: "the-code", code_verifier: "v".repeat(43), grant_type: "authorization_code", redirect_uri: "r" });
  });

  it("fails plainly when Google refuses the code or can't be reached", async () => {
    const pending = { state: "s".repeat(43), verifier: "v".repeat(43), nonce: "n".repeat(43), next: "/", remember: false };
    const client = { id: clientId, secret: "x" };
    const refused = vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(finishSignIn({ code: "c", pending, client, redirect: "r", fetchImpl: refused })).rejects.toMatchObject({ kind: "failed" });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(finishSignIn({ code: "c", pending, client, redirect: "r", fetchImpl: offline })).rejects.toMatchObject({ kind: "failed" });
  });
});

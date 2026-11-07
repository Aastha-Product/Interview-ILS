import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { firebaseConfig, firebaseIdentity, lookUpWithEmulator, verifyFirebaseIdToken } from "./firebase";

vi.mock("@/lib/env", () => ({ env: {} }));

// Pathfinder: checking the ID token Firebase gives the browser, with a key of our own standing
// in for Google's.

const projectId = "pathfinder-test";
const now = new Date("2026-11-07T10:00:00Z");
const seconds = Math.floor(now.getTime() / 1000);

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

function token(claims: Record<string, unknown> = {}, { key = privateKey, iat = seconds - 30 }: { key?: CryptoKey; iat?: number } = {}) {
  const { iss = `https://securetoken.google.com/${projectId}`, aud = projectId, ...rest } = claims;
  return new SignJWT({ auth_time: iat, email: "asha@example.com", email_verified: true, name: "Asha Rao", ...rest })
    .setProtectedHeader({ alg: "RS256", kid: "key-1" })
    .setIssuer(String(iss))
    .setAudience(String(aud))
    .setSubject("firebase-asha")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);
}

const verify = async (idToken: string) => verifyFirebaseIdToken(idToken, { projectId, keys, now });

describe("verifyFirebaseIdToken", () => {
  it("returns who a genuine token is for", async () => {
    await expect(verify(await token({ email: "Asha@Example.com" }))).resolves.toEqual({
      uid: "firebase-asha",
      email: "asha@example.com",
      emailVerified: true,
      name: "Asha Rao",
    });
  });

  it("reports an unverified address as such, for the sign-in to refuse", async () => {
    await expect(verify(await token({ email_verified: false }))).resolves.toMatchObject({ emailVerified: false });
  });

  it("refuses tokens signed with another key, for another project, or from another issuer", async () => {
    await expect(verify(await token({}, { key: otherKey }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(verify(await token({ aud: "someone-else" }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(verify(await token({ iss: "https://securetoken.google.com/someone-else" }))).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refuses expired tokens, and ones issued over 10 minutes ago (a replay)", async () => {
    await expect(verify(await token({}, { iat: seconds - 2 * 3600 }))).rejects.toMatchObject({ kind: "invalid" });
    await expect(verify(await token({}, { iat: seconds - 11 * 60 }))).rejects.toMatchObject({ kind: "invalid" });
  });

  it("refuses unsigned tokens and anything that isn't a token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ iss: `https://securetoken.google.com/${projectId}`, aud: projectId, sub: "x", iat: seconds, exp: seconds + 60, auth_time: seconds }),
    ).toString("base64url");
    await expect(verify(`${header}.${payload}.`)).rejects.toMatchObject({ kind: "invalid" });
    await expect(verify("garbage")).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("the Auth emulator (local testing)", () => {
  it("asks the emulator who a token is for", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ users: [{ localId: "emu-1", email: "Asha@Example.com", emailVerified: true, displayName: "Asha" }] }),
    );
    await expect(lookUpWithEmulator("emulator-token", { emulatorUrl: "http://127.0.0.1:9099", apiKey: "k", fetchImpl })).resolves.toEqual({
      uid: "emu-1",
      email: "asha@example.com",
      emailVerified: true,
      name: "Asha",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:lookup?key=k",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ idToken: "emulator-token" }) }),
    );
  });

  it("refuses a token the emulator doesn't know, and says so when it can't be reached", async () => {
    const refused = vi.fn(async () => Response.json({ error: { message: "INVALID_ID_TOKEN" } }, { status: 400 }));
    await expect(lookUpWithEmulator("t", { emulatorUrl: "http://127.0.0.1:9099", apiKey: "k", fetchImpl: refused })).rejects.toMatchObject({
      kind: "invalid",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(lookUpWithEmulator("t", { emulatorUrl: "http://127.0.0.1:9099", apiKey: "k", fetchImpl: offline })).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});

describe("firebaseConfig", () => {
  const full = {
    PATHFINDER_FIREBASE_API_KEY: "key",
    PATHFINDER_FIREBASE_AUTH_DOMAIN: "pathfinder-test.firebaseapp.com",
    PATHFINDER_FIREBASE_PROJECT_ID: projectId,
  };

  it("needs all three settings, and adds the emulator's address when it's set", () => {
    expect(firebaseConfig(full)).toEqual({ apiKey: "key", authDomain: "pathfinder-test.firebaseapp.com", projectId, emulatorUrl: null });
    expect(firebaseConfig({ ...full, PATHFINDER_FIREBASE_PROJECT_ID: undefined })).toBeNull();
    expect(firebaseConfig({ ...full, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" })?.emulatorUrl).toBe("http://127.0.0.1:9099");
  });

  it("refuses to sign anyone in while Firebase isn't set up", async () => {
    await expect(firebaseIdentity("t", null)).rejects.toMatchObject({ kind: "not-configured" });
  });
});

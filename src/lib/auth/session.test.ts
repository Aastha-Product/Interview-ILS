import { EncryptJWT } from "jose";
import { describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password-hash";
import { deriveKey } from "@/lib/keys";

import {
  decodeSession,
  encodeSession,
  passwordFingerprint,
  passwordMatches,
  SESSION_LIFETIME,
} from "./session";

const secret = "a".repeat(32);
const key = deriveKey("session", secret);
const otherKey = deriveKey("session", "b".repeat(32));
const fingerprint = passwordFingerprint("correct horse", deriveKey("password-fingerprint", secret));
const now = new Date("2026-09-27T12:00:00Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe("session tokens", () => {
  it("round-trips a browser session that lasts 24 hours", async () => {
    const token = await encodeSession({ persistent: false, userId: "test-student" }, { key, fingerprint, now });
    expect(await decodeSession(token, { key, fingerprint, now })).toEqual({
      userId: "test-student",
      persistent: false,
      version: 0,
      issuedAt: now,
      expiresAt: later(24 * 60 * 60),
    });
    expect(await decodeSession(token, { key, fingerprint, now: later(SESSION_LIFETIME.browser - 1) })).not.toBeNull();
    expect(await decodeSession(token, { key, fingerprint, now: later(SESSION_LIFETIME.browser) })).toBeNull();
  });

  it("carries the student's session version, and reads tokens from before versions as version 0", async () => {
    const token = await encodeSession({ persistent: false, userId: "test-student", version: 3 }, { key, fingerprint, now });
    expect(await decodeSession(token, { key, fingerprint, now })).toMatchObject({ version: 3 });
    const old = await new EncryptJWT({ persistent: false, pwd: fingerprint, uid: "test-student" })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 60)
      .encrypt(key);
    expect(await decodeSession(old, { key, fingerprint, now })).toMatchObject({ version: 0 });
  });

  it("keeps a persistent session for 30 days", async () => {
    const token = await encodeSession({ persistent: true, userId: "test-student" }, { key, fingerprint, now });
    expect(await decodeSession(token, { key, fingerprint, now: later(29 * 24 * 60 * 60) })).toMatchObject({ persistent: true, userId: "test-student" });
    expect(await decodeSession(token, { key, fingerprint, now: later(30 * 24 * 60 * 60) })).toBeNull();
  });

  it("refuses a session that names no student, like one from before accounts (Pathfinder)", async () => {
    for (const userId of [undefined, ""]) {
      const token = await encodeSession({ persistent: true, userId: userId as unknown as string }, { key, fingerprint, now });
      expect(await decodeSession(token, { key, fingerprint, now })).toBeNull();
    }
  });

  it("is encrypted, not just signed", async () => {
    const token = await encodeSession({ persistent: true, userId: "test-student" }, { key, fingerprint, now });
    expect(token.split(".")).toHaveLength(5); // JWE compact serialization
    expect(token).not.toContain(Buffer.from('"persistent"').toString("base64url"));
  });

  it("rejects tampered tokens, other keys and missing cookies", async () => {
    const token = await encodeSession({ persistent: false, userId: "test-student" }, { key, fingerprint, now });
    const parts = token.split(".");
    const flipped = parts[3].startsWith("A") ? `B${parts[3].slice(1)}` : `A${parts[3].slice(1)}`;
    const tampered = [...parts.slice(0, 3), flipped, parts[4]].join(".");

    expect(await decodeSession(tampered, { key, fingerprint, now })).toBeNull();
    expect(await decodeSession(token, { key: otherKey, fingerprint, now })).toBeNull();
    expect(await decodeSession("not-a-token", { key, fingerprint, now })).toBeNull();
    expect(await decodeSession(undefined, { key, fingerprint, now })).toBeNull();
  });

  it("rejects well-formed tokens without the session's claims", async () => {
    const noFlag = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime("1h")
      .encrypt(key);
    expect(await decodeSession(noFlag, { key, fingerprint, now })).toBeNull();

    const noExpiry = await new EncryptJWT({ persistent: false, userId: "test-student" })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuedAt()
      .encrypt(key);
    expect(await decodeSession(noExpiry, { key, fingerprint, now })).toBeNull();
  });
});

describe("password check", () => {
  it("accepts only the password that DOSSIER_PASSWORD is a hash of", async () => {
    const hash = await hashPassword("correct horse");
    expect(await passwordMatches("correct horse", hash)).toBe(true);
    expect(await passwordMatches("Correct horse", hash)).toBe(false);
    expect(await passwordMatches("", hash)).toBe(false);
    // The password itself where its hash belongs never matches.
    expect(await passwordMatches("correct horse", "correct horse")).toBe(false);
  });
});

describe("derived keys", () => {
  it("gives each purpose its own key", () => {
    const secret = "c".repeat(32);
    expect(deriveKey("session", secret)).toHaveLength(32);
    expect(deriveKey("session", secret)).toEqual(deriveKey("session", secret));
    expect(deriveKey("session", secret)).not.toEqual(deriveKey("password-fingerprint", secret));
  });
});

describe("password fingerprint", () => {
  const fingerprintKey = deriveKey("password-fingerprint", secret);

  it("ends sessions created while another password was set", async () => {
    const token = await encodeSession({ persistent: true, userId: "test-student" }, { key, fingerprint, now });
    const changed = passwordFingerprint("new password", fingerprintKey);
    expect(await decodeSession(token, { key, fingerprint: changed, now })).toBeNull();
    expect(await decodeSession(token, { key, fingerprint, now })).not.toBeNull();
  });

  it("is short, stable and doesn't reveal the password", () => {
    expect(fingerprint).toHaveLength(16);
    expect(passwordFingerprint("correct horse", fingerprintKey)).toBe(fingerprint);
    expect(fingerprint).not.toContain("correct");
    // Keyed with the secret: the same password under another secret gives another fingerprint.
    expect(passwordFingerprint("correct horse", deriveKey("password-fingerprint", "b".repeat(32)))).not.toBe(fingerprint);
  });
});

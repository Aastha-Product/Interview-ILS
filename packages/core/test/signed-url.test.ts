import { describe, expect, it } from "vitest";
import {
  authorizeLocalFileRequest,
  contentTypeForKey,
  createMemoryStorage,
  safeFilename,
  signLocalFileUrl,
  verifyLocalFileUrl,
} from "../src/storage";

const signing = { secret: "test-secret-0123456789abcdef", appUrl: "http://localhost:3000" };
const key = "users/user_a/applications/app1/resume-v2.pdf";
const now = new Date("2026-11-04T10:00:00Z");

function params(url: string) {
  const u = new URL(url);
  return { key: u.searchParams.get("key"), exp: u.searchParams.get("exp"), name: u.searchParams.get("name"), sig: u.searchParams.get("sig") };
}

describe("locally signed download links", () => {
  it("builds a /api/files link that verifies", () => {
    const url = signLocalFileUrl(signing, key, { filename: "Asha Verma - Resume.pdf" }, now);
    expect(url.startsWith("http://localhost:3000/api/files?")).toBe(true);
    expect(verifyLocalFileUrl(params(url), signing.secret, now)).toEqual({ ok: true, key, filename: "Asha Verma - Resume.pdf" });
  });

  it("rejects a tampered key, name or signature", () => {
    const p = params(signLocalFileUrl(signing, key, { filename: "r.pdf" }, now));
    expect(verifyLocalFileUrl({ ...p, key: "users/user_b/applications/app1/resume-v2.pdf" }, signing.secret, now)).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyLocalFileUrl({ ...p, name: "other.pdf" }, signing.secret, now)).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyLocalFileUrl({ ...p, sig: `${p.sig}x` }, signing.secret, now)).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyLocalFileUrl(p, "another-secret-0123456789", now)).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyLocalFileUrl({ ...p, sig: null }, signing.secret, now)).toMatchObject({ ok: false, reason: "missing" });
  });

  it("expires after the default 5 minutes", () => {
    const p = params(signLocalFileUrl(signing, key, { filename: "r.pdf" }, now));
    expect(verifyLocalFileUrl(p, signing.secret, new Date(now.getTime() + 299_000)).ok).toBe(true);
    expect(verifyLocalFileUrl(p, signing.secret, new Date(now.getTime() + 301_000))).toMatchObject({ ok: false, reason: "expired" });
  });

  it("only lets the owner download, even with a valid link", () => {
    const p = params(signLocalFileUrl(signing, key, { filename: "r.pdf" }, now));
    expect(authorizeLocalFileRequest(p, "user_a", signing.secret, now)).toMatchObject({ ok: true, key });
    expect(authorizeLocalFileRequest(p, "user_b", signing.secret, now)).toEqual({ ok: false, status: 403 });
    expect(authorizeLocalFileRequest(p, "user_", signing.secret, now)).toEqual({ ok: false, status: 403 });
    expect(authorizeLocalFileRequest(p, "", signing.secret, now)).toEqual({ ok: false, status: 403 });
  });

  it("refuses to sign unsafe keys", () => {
    expect(() => signLocalFileUrl(signing, "../etc/passwd", { filename: "x" }, now)).toThrow();
    expect(() => signLocalFileUrl(signing, "users/a/../../b", { filename: "x" }, now)).toThrow();
  });

  it("memory storage signs with the same scheme; without a secret it refuses", async () => {
    const url = await createMemoryStorage(signing).signedUrl(key, { filename: "r.pdf" });
    expect(verifyLocalFileUrl(params(url), signing.secret).ok).toBe(true);
    await expect(createMemoryStorage().signedUrl(key, { filename: "r.pdf" })).rejects.toThrow();
  });

  it("cleans file names and picks content types", () => {
    expect(safeFilename(`Asha "Verma"/../Resume.pdf`)).toBe("Asha Verma..Resume.pdf");
    expect(safeFilename("")).toBe("download");
    expect(contentTypeForKey(key)).toBe("application/pdf");
    expect(contentTypeForKey("users/a/x.bin")).toBe("application/octet-stream");
  });
});

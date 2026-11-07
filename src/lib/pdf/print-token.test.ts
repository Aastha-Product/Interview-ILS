import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import { deriveKey } from "@/lib/keys";

import { PRINT_TOKEN_LIFETIME_SECONDS, printTokenStudent, signPrintToken, verifyPrintToken } from "./print-token";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

describe("print tokens", () => {
  it("open the page they were made for", async () => {
    const token = await signPrintToken("/print/base", "student-a");
    expect(await verifyPrintToken(token, "/print/base")).toBe(true);
  });

  it("don't open any other page", async () => {
    const token = await signPrintToken("/print/base", "student-a");
    expect(await verifyPrintToken(token, "/print/resume/1")).toBe(false);
    expect(await verifyPrintToken(token, "/print/base/")).toBe(false);
  });

  it("expire after a minute", async () => {
    const token = await signPrintToken("/print/base", "student-a");
    const later = new Date(Date.now() + (PRINT_TOKEN_LIFETIME_SECONDS + 1) * 1000);
    expect(await verifyPrintToken(token, "/print/base", { now: later })).toBe(false);
  });

  it("need the server's secret", async () => {
    const forged = await signPrintToken("/print/base", "student-a", "b".repeat(32));
    expect(await verifyPrintToken(forged, "/print/base")).toBe(false);
    expect(await verifyPrintToken("garbage", "/print/base")).toBe(false);
    expect(await verifyPrintToken(null, "/print/base")).toBe(false);
  });

  it("name the student whose document they print (QA H-1)", async () => {
    expect(await printTokenStudent(await signPrintToken("/print/base", "student-a"), "/print/base")).toBe("student-a");
    expect(await printTokenStudent(await signPrintToken("/print/base", "student-b"), "/print/base")).toBe("student-b");
    expect(await printTokenStudent(await signPrintToken("/print/base", "student-a"), "/print/resume/1")).toBeNull();
    await expect(signPrintToken("/print/base", "")).rejects.toThrow();
  });

  it("refuse an older token that names no student", async () => {
    const old = await new SignJWT({ path: "/print/base" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("dossier-print")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(deriveKey("print-token"));
    expect(await printTokenStudent(old, "/print/base")).toBeNull();
    expect(await verifyPrintToken(old, "/print/base")).toBe(false);
  });
});

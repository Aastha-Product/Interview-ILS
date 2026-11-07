import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, createNonce, firebaseSources } from "./csp";

describe("contentSecurityPolicy (E11-5)", () => {
  it("allows scripts only with the nonce, and nothing from other hosts", () => {
    const policy = contentSecurityPolicy("abc");
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("lets forms go to this server and on to Google's sign-in only (Pathfinder)", () => {
    expect(contentSecurityPolicy("abc")).toContain("form-action 'self' https://accounts.google.com;");
    expect(contentSecurityPolicy("abc", { formTargets: [] })).toContain("form-action 'self';");
  });

  it("allows eval in development, and upgrades requests over HTTPS", () => {
    expect(contentSecurityPolicy("abc", { dev: true })).toContain("'strict-dynamic' 'unsafe-eval'");
    expect(contentSecurityPolicy("abc", { https: true })).toMatch(/; upgrade-insecure-requests$/);
  });
});

describe("createNonce", () => {
  it("is fresh every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    expect([...nonces][0]).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("Firebase sign-in's sources (Pathfinder)", () => {
  it("lets the page call Firebase's sign-in APIs and frame the project's auth domain, and nothing without Firebase", () => {
    const sources = firebaseSources({ authDomain: "p.firebaseapp.com", emulatorUrl: null });
    expect(sources).toEqual({ connect: ["https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com"], frame: ["https://p.firebaseapp.com"] });
    const policy = contentSecurityPolicy("abc", { connectTargets: sources.connect, frameTargets: sources.frame });
    expect(policy).toContain("connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com");
    expect(policy).toContain("frame-src 'self' https://p.firebaseapp.com");
    expect(firebaseSources(null)).toEqual({ connect: [], frame: [] });
    expect(contentSecurityPolicy("abc")).not.toContain("frame-src");
  });

  it("uses the local emulator instead, while testing", () => {
    expect(firebaseSources({ authDomain: "p.firebaseapp.com", emulatorUrl: "http://127.0.0.1:9099" })).toEqual({
      connect: ["http://127.0.0.1:9099"],
      frame: ["http://127.0.0.1:9099"],
    });
  });
});

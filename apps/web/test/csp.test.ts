import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "../server/csp";

describe("buildCsp", () => {
  it("allows scripts only with the nonce in production, and no eval", () => {
    const csp = buildCsp({ nonce: "abc123", isDev: false, https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self' https://accounts.google.com");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("adds what development needs, and doesn't upgrade plain-http localhost", () => {
    const csp = buildCsp({ nonce: "n", isDev: true, https: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("createNonce", () => {
  it("is fresh every time and long enough not to guess", () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const n of nonces) expect(Buffer.from(n, "base64").length).toBe(16);
  });
});

// This Next.js version still exports the matcher helper under its Middleware name.
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { encodeSession, passwordFingerprint, SESSION_COOKIE } from "@/lib/auth/session";
import { deriveKey } from "@/lib/keys";
import { messages } from "@/lib/messages";
import { PRINT_TOKEN_HEADER, signPrintToken } from "@/lib/pdf/print-token";

import { config, proxy } from "./proxy";

const flags = vi.hoisted(() => ({ startups: "off" as "on" | "off", firebase: false }));
vi.mock("@/lib/env", () => ({
  env: {
    DOSSIER_SECRET: "a".repeat(32),
    DOSSIER_PASSWORD: "correct horse",
    get PATHFINDER_STARTUPS() {
      return flags.startups;
    },
    // Pathfinder: a Firebase project, while a test turns it on.
    get PATHFINDER_FIREBASE_API_KEY() {
      return flags.firebase ? "test-api-key" : undefined;
    },
    get PATHFINDER_FIREBASE_AUTH_DOMAIN() {
      return flags.firebase ? "pathfinder-test.firebaseapp.com" : undefined;
    },
    get PATHFINDER_FIREBASE_PROJECT_ID() {
      return flags.firebase ? "pathfinder-test" : undefined;
    },
  },
}));

const key = deriveKey("session", "a".repeat(32));
const fingerprint = passwordFingerprint("correct horse", deriveKey("password-fingerprint", "a".repeat(32)));

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

function request(path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", `${SESSION_COOKIE}=${init.cookie}`);
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

describe("proxy matcher", () => {
  it("runs on pages, the sign-in page and API routes", () => {
    for (const url of ["/", "/login", "/profile", "/applications/abc", "/new", "/dev/ui", "/api/pdf/1", "/loginx"]) {
      expect(matches(url), url).toBe(true);
    }
  });

  it("skips the health check, Next.js assets and public files", () => {
    for (const url of [
      "/api/health",
      "/_next/static/chunks/app.js",
      "/_next/static/media/Geist.woff2",
      "/_next/image?url=/a.png&w=64&q=75",
      "/_next/hmr",
      "/favicon.ico",
      "/next.svg",
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });
});

describe("proxy", () => {
  it("lets signed-in requests through", async () => {
    const token = await encodeSession({ persistent: false, userId: "test-student" }, { key, fingerprint });
    const response = await proxy(request("/profile", { cookie: token }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("gives pages a Content-Security-Policy with a fresh nonce, for the browser and for Next.js (E11-5)", async () => {
    const token = await encodeSession({ persistent: false, userId: "test-student" }, { key, fingerprint });
    const first = await proxy(request("/profile", { cookie: token }));
    const second = await proxy(request("/login"));
    const policy = first.headers.get("content-security-policy");
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    // Next.js reads the request's copy to put the nonce on its scripts.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(second.headers.get("x-middleware-next")).toBe("1");
    expect(second.headers.get("content-security-policy")).not.toBe(policy);
  });

  it("upgrades insecure requests only when the page was asked for over HTTPS", async () => {
    const plain = await proxy(request("/login"));
    const behindTls = await proxy(request("/login", { headers: { "x-forwarded-proto": "https" } }));
    expect(plain.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
    expect(behindTls.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
  });

  it("leaves API answers without a policy", async () => {
    const token = await encodeSession({ persistent: false, userId: "test-student" }, { key, fingerprint });
    const response = await proxy(request("/api/pdf/1", { cookie: token }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("sends signed-out visitors to /login, remembering where they were going", async () => {
    expect(getRedirectUrl(await proxy(request("/applications/abc?tab=letter")))).toBe(
      "http://localhost:3000/login?next=%2Fapplications%2Fabc%3Ftab%3Dletter",
    );
  });

  it("shows signed-out visitors the homepage at the site's address, and signed-in ones the app (Pathfinder)", async () => {
    const response = await proxy(request("/"));
    expect(getRedirectUrl(response)).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/welcome");
    expect(response.headers.get("content-security-policy")).toMatch(/'nonce-/);
    const token = await encodeSession({ persistent: false, userId: "test-student" }, { key, fingerprint });
    const signedIn = await proxy(request("/", { cookie: token }));
    expect(signedIn.headers.get("x-middleware-rewrite")).toBeNull();
    expect(signedIn.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets signed-out visitors reach the homepage, signing in, up and resetting a password (Pathfinder)", async () => {
    for (const path of ["/welcome", "/login", "/signup", "/reset-password"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
      expect(response.headers.get("content-security-policy"), path).toMatch(/'nonce-/);
    }
    expect(getRedirectUrl(await proxy(request("/signup/more")))).toBe("http://localhost:3000/login?next=%2Fsignup%2Fmore");
  });

  it("lets pages talk to Firebase only where students sign in with it (Pathfinder)", async () => {
    const plain = (await proxy(request("/login"))).headers.get("content-security-policy")!;
    expect(plain).toContain("connect-src 'self';");
    expect(plain).not.toContain("frame-src");
    flags.firebase = true;
    try {
      const policy = (await proxy(request("/login"))).headers.get("content-security-policy")!;
      expect(policy).toContain("connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;");
      expect(policy).toContain("frame-src 'self' https://pathfinder-test.firebaseapp.com;");
    } finally {
      flags.firebase = false;
    }
  });

  it("treats an expired, forged or pre-password-change cookie as signed out", async () => {
    const expired = await encodeSession(
      { persistent: false, userId: "test-student" },
      { key, fingerprint, now: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    );
    const forged = await encodeSession({ persistent: true, userId: "test-student" }, { key: deriveKey("session", "b".repeat(32)), fingerprint });
    const oldPassword = await encodeSession({ persistent: true, userId: "test-student" }, { key, fingerprint: "stale-fingerprint" });
    for (const cookie of [expired, forged, oldPassword, "garbage"]) {
      expect(getRedirectUrl(await proxy(request("/profile", { cookie })))).toContain("/login");
    }
  });

  it("lets the Claude connector's endpoint, sign-in and metadata through without a session (#221)", async () => {
    for (const path of ["/api/mcp", "/api/oauth/token", "/api/oauth/register", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
    }
    // The consent page is an ordinary page: sign in first.
    expect(getRedirectUrl(await proxy(request("/oauth/authorize?client_id=x")))).toBe("http://localhost:3000/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dx");
    expect((await proxy(request("/api/mcpx"))).status).toBe(401);
  });

  it("lets signed-out visitors start and finish signing in with Google, and nothing else under it (Pathfinder)", async () => {
    for (const path of ["/api/auth/google", "/api/auth/google/callback"]) {
      expect((await proxy(request(path))).headers.get("x-middleware-next"), path).toBe("1");
    }
    expect((await proxy(request("/api/auth/google/other"))).status).toBe(401);
    expect((await proxy(request("/api/auth/googlex"))).status).toBe(401);
  });

  it("lets signed-out visitors read the privacy notice, and nothing beside it (Pathfinder)", async () => {
    const response = await proxy(request("/privacy"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toMatch(/'nonce-/);
    expect(getRedirectUrl(await proxy(request("/privacy/more")))).toBe("http://localhost:3000/login?next=%2Fprivacy%2Fmore");
    expect(getRedirectUrl(await proxy(request("/privacyx")))).toBe("http://localhost:3000/login?next=%2Fprivacyx");
  });

  it("shows the not-found page for Startups while PATHFINDER_STARTUPS is off, and the screen while it's on (Pathfinder)", async () => {
    const token = await encodeSession({ persistent: false, userId: "test-student" }, { key, fingerprint });
    for (const path of ["/startups", "/startups?status=SAVED", "/startups/anything"]) {
      const response = await proxy(request(path, { cookie: token }));
      expect(response.headers.get("x-middleware-rewrite"), path).toBe("http://localhost:3000/_not-found");
      expect(response.headers.get("content-security-policy"), path).toMatch(/'nonce-/);
    }
    // Only Startups' own paths.
    expect((await proxy(request("/startupsx", { cookie: token }))).headers.get("x-middleware-rewrite")).toBeNull();
    flags.startups = "on";
    try {
      const response = await proxy(request("/startups", { cookie: token }));
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    } finally {
      flags.startups = "off";
    }
  });

  it("answers API requests with 401 JSON instead of a redirect", async () => {
    const response = await proxy(request("/api/pdf/1"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: messages.signedOut });
  });

  it("leaves Server Action calls to the action's own session check", async () => {
    const response = await proxy(request("/profile", { headers: { "next-action": "abc123" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets the PDF renderer open a print page with a token for that page", async () => {
    const token = await signPrintToken("/print/base", "student-a");
    const response = await proxy(request("/print/base", { headers: { [PRINT_TOKEN_HEADER]: token } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses print tokens for another page, forged ones and tokens outside /print", async () => {
    const other = await signPrintToken("/print/resume/1", "student-a");
    const forged = await signPrintToken("/print/base", "student-a", "b".repeat(32));
    for (const token of [other, forged, "garbage"]) {
      const response = await proxy(request("/print/base", { headers: { [PRINT_TOKEN_HEADER]: token } }));
      expect(getRedirectUrl(response)).toContain("/login");
    }
    const profileToken = await signPrintToken("/profile", "student-a");
    const response = await proxy(request("/profile", { headers: { [PRINT_TOKEN_HEADER]: profileToken } }));
    expect(getRedirectUrl(response)).toContain("/login");
  });
});

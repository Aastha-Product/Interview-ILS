import path from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// One .env at the repository root serves every package.
const repoRoot = path.resolve(process.cwd(), "../..");
config({ path: path.join(repoRoot, ".env"), quiet: true });
// Development file storage lives next to the local database, unless .env says otherwise.
process.env.STORAGE_LOCAL_DIR ||= path.join(repoRoot, ".local", "storage");

// The Content-Security-Policy is set per request in proxy.ts (it carries a nonce).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // HTTPS deployments only: tells browsers never to use plain http for this site (2 years).
  ...((process.env.APP_URL ?? "").startsWith("https://")
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  transpilePackages: ["@pathfinder/core", "@pathfinder/ai", "@pathfinder/db", "@pathfinder/feeds"],
  serverExternalPackages: ["pino", "mammoth", "unpdf", "pg", "@prisma/client", "@prisma/adapter-pg"],
  turbopack: { root: repoRoot },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

import { z } from "zod";

/** Empty strings in .env mean "not set". */
const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /**
     * Which deployment this is. Staging runs a production build (NODE_ENV=production) with test data
     * only: it shows a banner, and demo seeding is allowed. Demo seeding is refused in production.
     * Demo is a self-contained test site (e.g. Vercel alone): a password-protected demo sign-in,
     * files in the database, and drafting and PDFs run inside the web app instead of a worker.
     */
    APP_ENV: z.enum(["development", "staging", "demo", "production"]).default("development"),
    /** Required when APP_ENV=demo: the shared password for the demo sign-in. */
    DEMO_PASSWORD: optional,
    DATABASE_URL: z.string().trim().min(1, "is required"),
    AUTH_SECRET: z.string().trim().min(16, "must be at least 16 characters"),
    AUTH_GOOGLE_ID: optional,
    AUTH_GOOGLE_SECRET: optional,
    GEMINI_API_KEY: optional,
    GEMINI_MODEL: z.string().trim().default("gemini-flash-latest"),
    FALLBACK_AI_BASE_URL: optional.pipe(z.url().optional()),
    FALLBACK_AI_API_KEY: optional,
    FALLBACK_AI_MODEL: optional,
    JSEARCH_API_KEY: optional,
    JSEARCH_DAILY_BUDGET: z.coerce.number().int().min(0).default(6),
    ADZUNA_APP_ID: optional,
    ADZUNA_APP_KEY: optional,
    ADZUNA_COUNTRY: z.string().trim().length(2).default("in"),
    ADZUNA_DAILY_BUDGET: z.coerce.number().int().min(0).default(50),
    SEARCH_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(300),
    SEARCH_CACHE_HOURS: z.coerce.number().int().min(1).default(24),
    TAILOR_DAILY_LIMIT: z.coerce.number().int().min(0).default(20),
    AI_CONCURRENT_PER_USER: z.coerce.number().int().min(1).default(2),
    RATE_LIMIT_API_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_SIGNIN_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    /** "database" keeps files in Postgres (demo sites only). Defaults to "database" in demo, else "local". */
    STORAGE_DRIVER: z.enum(["local", "s3", "database"]).optional(),
    STORAGE_LOCAL_DIR: optional,
    S3_ENDPOINT: optional,
    S3_REGION: z.string().trim().default("us-east-1"),
    S3_BUCKET: optional,
    S3_ACCESS_KEY: optional,
    S3_SECRET_KEY: optional,
    SENTRY_DSN: optional,
    APP_URL: z.url().default("http://localhost:3000"),
    /** Proxies in front of the app that append to X-Forwarded-For (1 on most container hosts; 2 behind a CDN too). */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const fallback = [
      env.FALLBACK_AI_BASE_URL,
      env.FALLBACK_AI_API_KEY,
      env.FALLBACK_AI_MODEL,
    ].filter(Boolean).length;
    if (fallback !== 0 && fallback !== 3) {
      fail("FALLBACK_AI_BASE_URL", "set all three FALLBACK_AI_* values, or none of them");
    }
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
        if (!env[key]) fail(key, "is required when STORAGE_DRIVER=s3");
      }
    }
    const demo = env.APP_ENV === "demo";
    if (demo && (!env.DEMO_PASSWORD || env.DEMO_PASSWORD.length < 8)) {
      fail("DEMO_PASSWORD", "is required in demo mode (at least 8 characters)");
    }
    if (!demo && env.STORAGE_DRIVER === "database")
      fail("STORAGE_DRIVER", "database storage is only for demo sites (APP_ENV=demo)");
    if (env.NODE_ENV === "production") {
      if (env.AUTH_SECRET === "change-me")
        fail("AUTH_SECRET", "must be changed from the example value");
      if (demo) {
        if (env.STORAGE_DRIVER === "local")
          fail("STORAGE_DRIVER", "must be database or s3 on a demo site");
      } else {
        if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET)
          fail("AUTH_GOOGLE_ID", "Google sign-in must be configured in production");
        if (env.STORAGE_DRIVER !== "s3") fail("STORAGE_DRIVER", "must be s3 in production");
      }
    }
  })
  .transform((env) => ({
    ...env,
    STORAGE_DRIVER:
      env.STORAGE_DRIVER ?? (env.APP_ENV === "demo" ? ("database" as const) : ("local" as const)),
  }));

export type ServerConfig = z.infer<typeof schema>;

export class ConfigError extends Error {
  /** The setting names that are missing or wrong (never their values). */
  readonly settings: string[];

  constructor(problems: string[], settings: string[] = []) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.settings = settings;
  }
}

/**
 * Fills in values a host already provides under another name: Vercel's Postgres integration names
 * the database address POSTGRES_PRISMA_URL / POSTGRES_URL, and Vercel knows the site's own address.
 */
export function withHostDefaults(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out = { ...env };
  out.DATABASE_URL ||= env.POSTGRES_PRISMA_URL || env.POSTGRES_URL || undefined;
  if (!out.APP_URL && env.VERCEL_PROJECT_PRODUCTION_URL)
    out.APP_URL = `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return out;
}

/** Parses configuration. Error messages name the variable, never its value. */
export function parseConfig(rawEnv: Record<string, string | undefined>): ServerConfig {
  const result = schema.safeParse(withHostDefaults(rawEnv));
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`),
      [...new Set(result.error.issues.map((i) => String(i.path[0] ?? "")).filter(Boolean))],
    );
  }
  return result.data;
}

/**
 * Names of settings that are missing or invalid, or [] when the configuration is fine. For the
 * health check, so a deployment problem can be diagnosed without reading server logs.
 */
export function configProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems = new Set<string>();
  let current = { ...env };
  // A missing basic setting stops validation before the cross-setting rules (e.g. "demo mode needs
  // DEMO_PASSWORD") run. Stand in valid placeholders for those and check again, so every problem
  // is listed at once. The placeholders are never used for anything else.
  for (let round = 0; round < 3; round++) {
    try {
      parseConfig(current);
      break;
    } catch (error) {
      if (!(error instanceof ConfigError)) return ["unknown"];
      const fresh = error.settings.filter((s) => !problems.has(s));
      fresh.forEach((s) => problems.add(s));
      const fillable = fresh.filter((s) => s in PLACEHOLDERS);
      if (fillable.length === 0) break;
      current = { ...current, ...Object.fromEntries(fillable.map((s) => [s, PLACEHOLDERS[s]])) };
    }
  }
  return [...problems];
}

const PLACEHOLDERS: Record<string, string> = {
  DATABASE_URL: "postgresql://placeholder@localhost:5432/placeholder",
  AUTH_SECRET: "placeholder-secret-for-config-checks-only",
  APP_URL: "https://placeholder.invalid",
};

let cached: ServerConfig | undefined;

/** The validated server configuration. Refuses to start if anything required is missing. */
export function getConfig(): ServerConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Dev sign-in is offered only outside production and only while Google sign-in is not set up. */
export function isDevSignInEnabled(config: ServerConfig = getConfig()): boolean {
  return config.APP_ENV !== "demo" && config.NODE_ENV !== "production" && !config.AUTH_GOOGLE_ID;
}

/** Demo sign-in: any email, but only with the shared DEMO_PASSWORD. Demo sites only. */
export function isDemoSignInEnabled(config: ServerConfig = getConfig()): boolean {
  return config.APP_ENV === "demo" && Boolean(config.DEMO_PASSWORD);
}

/** Demo sites have no worker: drafting and PDFs run inside the web app. */
export function runsJobsInline(config: ServerConfig = getConfig()): boolean {
  return config.APP_ENV === "demo";
}

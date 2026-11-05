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
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: optional,
    S3_ENDPOINT: optional,
    S3_REGION: z.string().trim().default("us-east-1"),
    S3_BUCKET: optional,
    S3_ACCESS_KEY: optional,
    S3_SECRET_KEY: optional,
    SENTRY_DSN: optional,
    APP_URL: z.url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const fallback = [env.FALLBACK_AI_BASE_URL, env.FALLBACK_AI_API_KEY, env.FALLBACK_AI_MODEL].filter(Boolean).length;
    if (fallback !== 0 && fallback !== 3) {
      fail("FALLBACK_AI_BASE_URL", "set all three FALLBACK_AI_* values, or none of them");
    }
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
        if (!env[key]) fail(key, "is required when STORAGE_DRIVER=s3");
      }
    }
    if (env.NODE_ENV === "production") {
      if (env.AUTH_SECRET === "change-me") fail("AUTH_SECRET", "must be changed from the example value");
      if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) fail("AUTH_GOOGLE_ID", "Google sign-in must be configured in production");
      if (env.STORAGE_DRIVER !== "s3") fail("STORAGE_DRIVER", "must be s3 in production");
    }
  });

export type ServerConfig = z.infer<typeof schema>;

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** Parses configuration. Error messages name the variable, never its value. */
export function parseConfig(env: Record<string, string | undefined>): ServerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`));
  }
  return result.data;
}

let cached: ServerConfig | undefined;

/** The validated server configuration. Refuses to start if anything required is missing. */
export function getConfig(): ServerConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Dev sign-in is offered only outside production and only while Google sign-in is not set up. */
export function isDevSignInEnabled(config: ServerConfig = getConfig()): boolean {
  return config.NODE_ENV !== "production" && !config.AUTH_GOOGLE_ID;
}

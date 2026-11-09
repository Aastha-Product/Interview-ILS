import "server-only";

import path from "node:path";

import { z } from "zod";

import { isPasswordHash } from "@/lib/auth/password-hash";

const SECRET_MIN_LENGTH = 32;
const GENERATE_SECRET = "for example the output of `openssl rand -base64 32`";
const HASH_PASSWORD = "Make one with `docker run --rm -it ghcr.io/aientech/dossier hash-password`";

export const AI_PROVIDERS = ["local", "openai", "anthropic", "mistral", "lmstudio"] as const;
export const JOB_SOURCE_NAMES = ["jsearch", "adzuna", "arbeitsagentur", "freehire", "off"] as const;
export const SCORER_NAMES = ["ai", "jev"] as const;

// An empty value (`DOSSIER_AI_KEY=` in .env) counts as unset.
const unsetIfEmpty = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const required = (name: string, fix: string) =>
  z.preprocess(
    unsetIfEmpty,
    z.string({ error: `${name} is not set. ${fix}` }),
  );

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(unsetIfEmpty, schema.optional());

const schema = z.object({
  // Never echo the value: it may be the password itself, set by mistake.
  DOSSIER_PASSWORD: required(
    "DOSSIER_PASSWORD",
    `Set it to a hash of the password you want to sign in with. ${HASH_PASSWORD}.`,
  ).pipe(
    z.string().trim().refine(isPasswordHash, {
      error: `DOSSIER_PASSWORD must be a hash of your password, not the password itself. ${HASH_PASSWORD} and set DOSSIER_PASSWORD to what it prints.`,
    }),
  ),
  DOSSIER_SECRET: required(
    "DOSSIER_SECRET",
    `Set it to a random string of at least ${SECRET_MIN_LENGTH} characters, ${GENERATE_SECRET}.`,
  ).pipe(
    z.string().min(SECRET_MIN_LENGTH, {
      error: (issue) =>
        `DOSSIER_SECRET is too short (${String(issue.input).length} characters). Use at least ${SECRET_MIN_LENGTH} random characters, ${GENERATE_SECRET}.`,
    }),
  ),
  DATABASE_URL: required(
    "DATABASE_URL",
    "Set it to your PostgreSQL connection string, e.g. postgresql://user:password@host:5432/dossier.",
  ).pipe(
    // Never echo the value: it contains the database password.
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, {
        error: "DATABASE_URL must be a PostgreSQL connection string starting with postgresql://.",
      }),
  ),
  DOSSIER_DATA_DIR: z
    .preprocess(unsetIfEmpty, z.string().default("/data"))
    .transform((dir) => path.resolve(dir)),
  DOSSIER_BACKUP_RETENTION_DAYS: z
    .preprocess(unsetIfEmpty, z.string().trim().default("14"))
    .pipe(
      z.string().regex(/^\d+$/, {
        error: (issue) =>
          `DOSSIER_BACKUP_RETENTION_DAYS must be a whole number of days (got "${String(issue.input)}").`,
      }),
    )
    .transform(Number)
    .pipe(
      z.number().min(1, {
        error: "DOSSIER_BACKUP_RETENTION_DAYS must be at least 1.",
      }),
    ),
  // The daily usage ping (usage-ping.ts). Pathfinder: unset means off; only
  // on turns it on, for the whole server.
  DOSSIER_TELEMETRY: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["on", "off"], { error: (issue) => `DOSSIER_TELEMETRY must be on or off (got "${String(issue.input)}").` })),
  ).transform((value) => value ?? "off"),
  DOSSIER_AI_PROVIDER: optional(
    z.enum(AI_PROVIDERS, {
      error: (issue) =>
        `DOSSIER_AI_PROVIDER must be one of ${AI_PROVIDERS.join(", ")} (got "${String(issue.input)}").`,
    }),
  ),
  DOSSIER_AI_URL: optional(
    z.url({
      protocol: /^https?$/,
      error: "DOSSIER_AI_URL must be an http:// or https:// URL.",
    }),
  ),
  DOSSIER_AI_MODEL: optional(z.string()),
  // Never echo the value: it's an API key.
  DOSSIER_AI_KEY: optional(z.string()),
  DOSSIER_AI_TIMEOUT_SECONDS: optional(
    z
      .string()
      .trim()
      .regex(/^\d+$/, {
        error: (issue) =>
          `DOSSIER_AI_TIMEOUT_SECONDS must be a whole number of seconds (got "${String(issue.input)}").`,
      })
      .transform(Number)
      .pipe(z.number().min(5, { error: "DOSSIER_AI_TIMEOUT_SECONDS must be at least 5." })),
  ),
  // Defaults for Settings → Job search (E14-4), until a choice is saved there.
  DOSSIER_JOBS_SOURCE: optional(
    z.enum(JOB_SOURCE_NAMES, {
      error: (issue) => `DOSSIER_JOBS_SOURCE must be one of ${JOB_SOURCE_NAMES.join(", ")} (got "${String(issue.input)}").`,
    }),
  ),
  // Never echo the values: they're API keys.
  DOSSIER_JSEARCH_KEY: optional(z.string()),
  DOSSIER_JSEARCH_HOST: optional(
    z.enum(["openwebninja", "rapidapi"], {
      error: (issue) => `DOSSIER_JSEARCH_HOST must be openwebninja or rapidapi (got "${String(issue.input)}").`,
    }),
  ),
  DOSSIER_ADZUNA_APP_ID: optional(z.string()),
  DOSSIER_ADZUNA_KEY: optional(z.string()),
  // FreeHire origin; unset uses https://freehire.me. Point at a self-hosted
  // FreeHire, or leave unset for the public catalogue.
  DOSSIER_FREEHIRE_URL: optional(
    z.url({ protocol: /^https?$/, error: "DOSSIER_FREEHIRE_URL must be an http:// or https:// URL." }).transform((url) => url.replace(/\/+$/, "")),
  ),
  // Off takes the Bundesagentur für Arbeit out everywhere (#223): it isn't an
  // official API, so a server can choose not to offer it. Unset means on.
  DOSSIER_JOBS_ARBEITSAGENTUR: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["on", "off"], { error: (issue) => `DOSSIER_JOBS_ARBEITSAGENTUR must be on or off (got "${String(issue.input)}").` })),
  ),
  // Defaults for Settings → Scoring (#274), until a choice is saved there:
  // ai scores postings with the AI provider, jev with TypeSafe's Jev.
  DOSSIER_SCORER: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(SCORER_NAMES, { error: (issue) => `DOSSIER_SCORER must be one of ${SCORER_NAMES.join(", ")} (got "${String(issue.input)}").` })),
  ),
  // Never echo the value: it's an API key.
  DOSSIER_TYPESAFE_KEY: optional(z.string().trim()),
  // Google sign-in for Gmail and Calendar (E15-1): an OAuth client of type
  // "Web application". Settings → Google can save one instead, which wins.
  // Never echo the secret.
  DOSSIER_GOOGLE_CLIENT_ID: optional(z.string().trim()),
  DOSSIER_GOOGLE_CLIENT_SECRET: optional(z.string().trim()),
  // Pathfinder: how students sign in. "firebase" (the default once PATHFINDER_FIREBASE_* are set)
  // uses Firebase Authentication: email and password, password reset and Google. "google" (the
  // default once the client above is set) uses their Google account through this server's own
  // client; "code" lets anyone with the DOSSIER_PASSWORD access code in under any email, for
  // trials only.
  PATHFINDER_SIGN_IN: optional(
    z.enum(["firebase", "google", "code"], {
      error: (issue) => `PATHFINDER_SIGN_IN must be firebase, google or code (got "${String(issue.input)}").`,
    }),
  ),
  // Pathfinder: the Firebase project students sign in with (Firebase console → Project settings →
  // Your apps → Web app). None of these is a secret: the browser gets them. The server checks
  // the ID token Firebase gives the browser against the project ID.
  PATHFINDER_FIREBASE_API_KEY: optional(z.string().trim()),
  PATHFINDER_FIREBASE_AUTH_DOMAIN: optional(z.string().trim()),
  PATHFINDER_FIREBASE_PROJECT_ID: optional(z.string().trim()),
  // For local testing only: the Firebase Auth emulator's host:port, as firebase-tools names it.
  // With it set, the browser signs in at the emulator and the server asks the emulator who
  // that is, instead of checking Google's signature (the emulator signs nothing).
  FIREBASE_AUTH_EMULATOR_HOST: optional(
    z
      .string()
      .trim()
      .regex(/^(?:localhost|127\.0\.0\.1):\d+$/, { error: "FIREBASE_AUTH_EMULATOR_HOST must be a local host:port, e.g. 127.0.0.1:9099." }),
  ),
  // Pathfinder: Dossier's job-search tools (dashboard, Find jobs, Agent, Applications, Inbox, the
  // base resume) and their settings. Unset means on. off leaves students the resume analysis,
  // their profile and a short Settings, and closes the tools on the server.
  PATHFINDER_TOOLS: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["on", "off"], { error: (issue) => `PATHFINDER_TOOLS must be on or off (got "${String(issue.input)}").` })),
  ).transform((value) => value ?? "on"),
  // Pathfinder: the server runs the AI, the job search, scoring and Google for every student.
  // Unset means on: their settings come only from the DOSSIER_* variables, students never see
  // or set a provider, key or OAuth client, and anything a student saved is ignored. off brings
  // back Dossier's self-hosted Settings, where each user brings their own.
  PATHFINDER_MANAGED: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["on", "off"], { error: (issue) => `PATHFINDER_MANAGED must be on or off (got "${String(issue.input)}").` })),
  ).transform((value) => value ?? "on"),
  // Pathfinder: database connections this process keeps at most (default 20). Every web process
  // and worker has its own pool: together they must stay under Postgres's max_connections (100).
  PATHFINDER_DB_POOL: optional(
    z
      .string()
      .trim()
      .regex(/^\d+$/, { error: (issue) => `PATHFINDER_DB_POOL must be a whole number (got "${String(issue.input)}").` })
      .transform(Number)
      .pipe(z.number().min(2, { error: "PATHFINDER_DB_POOL must be at least 2." })),
  ),
  // Pathfinder: what this process does. all (the default): serves pages and runs the background
  // jobs and schedules, as one server. web: serves pages only; jobs wait in the database for a
  // worker. worker: runs the jobs and schedules (deploy/lightsail/compose.yml runs one of each).
  PATHFINDER_ROLE: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["all", "web", "worker"], { error: (issue) => `PATHFINDER_ROLE must be all, web or worker (got "${String(issue.input)}").` })),
  ),
  // Pathfinder: background jobs one process runs at once with a hosted AI (a local model always
  // gets one at a time). Unset means 10.
  PATHFINDER_JOB_CONCURRENCY: optional(
    z
      .string()
      .trim()
      .regex(/^\d+$/, { error: (issue) => `PATHFINDER_JOB_CONCURRENCY must be a whole number (got "${String(issue.input)}").` })
      .transform(Number)
      .pipe(z.number().min(1, { error: "PATHFINDER_JOB_CONCURRENCY must be at least 1." })),
  ),
  // Pathfinder: background jobs one student may have running at once, so no one holds up the
  // queue for everyone else. Unset means 2.
  PATHFINDER_JOBS_PER_STUDENT: optional(
    z
      .string()
      .trim()
      .regex(/^\d+$/, { error: (issue) => `PATHFINDER_JOBS_PER_STUDENT must be a whole number (got "${String(issue.input)}").` })
      .transform(Number)
      .pipe(z.number().min(1, { error: "PATHFINDER_JOBS_PER_STUDENT must be at least 1." })),
  ),
  // Pathfinder: how many AI requests each student may make per day on the server's shared key
  // (DOSSIER_AI_KEY); the count resets at midnight IST. Students with their own key in Settings
  // aren't limited. Unset means no limit.
  PATHFINDER_AI_DAILY_LIMIT: optional(
    z
      .string()
      .trim()
      .regex(/^\d+$/, { error: (issue) => `PATHFINDER_AI_DAILY_LIMIT must be a whole number (got "${String(issue.input)}").` })
      .transform(Number)
      .pipe(z.number().min(1, { error: "PATHFINDER_AI_DAILY_LIMIT must be at least 1." })),
  ),
  // Pathfinder: who may open the admin console (/admin), as a comma-separated list of the email
  // addresses they sign in with, e.g. "owner@example.com, ops@example.com". Unset means nobody.
  PATHFINDER_ADMIN_EMAILS: optional(z.string().trim()),
  // Pathfinder: on the server's own Claude key (DOSSIER_AI_PROVIDER=anthropic), the model for
  // reading a resume or posting into fields; DOSSIER_AI_MODEL does the rest, e.g. the review.
  // Unset means claude-sonnet-5-5.
  PATHFINDER_AI_READING_MODEL: optional(z.string().trim()),
  // Pathfinder: the model tried once when the first one is overloaded, limiting requests or
  // failing; "off" for none. Unset means claude-sonnet-5-5 on Claude, and no backup on other
  // providers (set one of theirs, e.g. gemini-3.5-flash-lite).
  PATHFINDER_AI_FALLBACK_MODEL: optional(z.string().trim()),
  // Pathfinder: Startups (#222) reads YC's job pages, Hacker News and
  // startups' own sites, but Pathfinder's jobs come only from licensed APIs or
  // what the student pastes. Unset means off: no menu item, its pages and
  // actions answer 404, and nothing is fetched. on brings it back.
  PATHFINDER_STARTUPS: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["on", "off"], { error: (issue) => `PATHFINDER_STARTUPS must be on or off (got "${String(issue.input)}").` })),
  ).transform((value) => value ?? "off"),
  // The address Dossier is reached at, e.g. https://dossier.example.com, for
  // Google's redirect. Defaults to the address of the request that connects.
  DOSSIER_PUBLIC_URL: optional(
    z.url({ protocol: /^https?$/, error: "DOSSIER_PUBLIC_URL must be an http:// or https:// URL." }).transform((url) => url.replace(/\/+$/, "")),
  ),
  // For the end-to-end tests only: sends every job source's requests to
  // <url>/<source> instead, where a fake source answers (e2e/fake-jobs.mts).
  DOSSIER_JOBS_TEST_BASE_URL: optional(
    z.url({ protocol: /^https?$/, error: "DOSSIER_JOBS_TEST_BASE_URL must be an http:// or https:// URL." }),
  ),
  // For the end-to-end tests only: sends Google's sign-in, Gmail and Calendar
  // requests to <url>/<host> instead, where a fake Google answers
  // (e2e/fake-google.mts).
  DOSSIER_GOOGLE_TEST_BASE_URL: optional(
    z.url({ protocol: /^https?$/, error: "DOSSIER_GOOGLE_TEST_BASE_URL must be an http:// or https:// URL." }),
  ),
  // For the end-to-end tests only: sends the usage ping to <url> instead of
  // the project's receiver (e2e/fake-jobs.mts answers).
  DOSSIER_USAGE_PING_TEST_URL: optional(
    z.url({ protocol: /^https?$/, error: "DOSSIER_USAGE_PING_TEST_URL must be an http:// or https:// URL." }),
  ),
  // For the end-to-end tests only: asks <url> for the latest release instead
  // of GitHub's API (e2e/fake-jobs.mts answers).
  DOSSIER_UPDATES_TEST_BASE_URL: optional(
    z.url({ protocol: /^https?$/, error: "DOSSIER_UPDATES_TEST_BASE_URL must be an http:// or https:// URL." }),
  ),
  // For the end-to-end tests only: sends Jev's requests to <url> instead of
  // TypeSafe's API (e2e/fake-jobs.mts answers).
  DOSSIER_TYPESAFE_TEST_BASE_URL: optional(
    z.url({ protocol: /^https?$/, error: "DOSSIER_TYPESAFE_TEST_BASE_URL must be an http:// or https:// URL." }),
  ),
}).check((context) => {
  if (context.value.DOSSIER_JOBS_SOURCE === "arbeitsagentur" && context.value.DOSSIER_JOBS_ARBEITSAGENTUR === "off") {
    context.issues.push({
      code: "custom",
      input: context.value,
      message: "DOSSIER_JOBS_SOURCE is arbeitsagentur, but DOSSIER_JOBS_ARBEITSAGENTUR is off. Choose another source, or remove one of the two.",
    });
  }
});

export type Env = z.infer<typeof schema>;

/** Thrown when the environment is invalid; `problems` has one message per variable. */
export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n${problems.join("\n")}`);
    this.name = "EnvError";
  }
}

/** Validates the environment. Messages name the variable and how to fix it, never its value. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => issue.message));
  }
  return result.data;
}

let cached: Env | undefined;

function load(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/**
 * The validated environment. It's parsed on first use rather than on import,
 * so `next build` works without the secrets; `checkEnvOnStartup()` makes sure
 * a running server has them.
 */
export const env: Readonly<Env> = new Proxy({} as Env, {
  get: (_, key) => load()[key as keyof Env],
});

/** Called once from `register()` in instrumentation.ts: stops the server if the environment is invalid. */
export function checkEnvOnStartup(): void {
  try {
    load();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    for (const problem of error.problems) {
      console.error(`Dossier can't start: ${problem}`);
    }
    process.exit(1);
  }
}

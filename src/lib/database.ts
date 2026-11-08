import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Dossier keeps its data in PostgreSQL. (Upstream also supports an SQLite file; Pathfinder's
// multi-user fork doesn't: it needs a database server, so DATABASE_URL must be a PostgreSQL
// connection string.)

/** Always false in this fork; kept so shared code can still ask. */
export function isSqliteUrl(url: string): boolean {
  void url;
  return false;
}

/**
 * Owner columns are left out of every result (Pathfinder: private accounts). The owner scope in
 * src/lib/owner/scope.ts fills them in on writes; nothing else needs them, and leaving them out
 * keeps them out of exports, copies and pages. Code that does need one selects it explicitly.
 */
const OWNER_OMIT = Object.fromEntries(
  [
    "profileField", "skill", "language", "experience", "experienceSkill", "project", "projectSkill",
    "education", "publication", "reference", "fact", "theme", "setting", "application", "statusEvent",
    "document", "documentVersion", "chatMessage", "note", "posting", "claudePaste", "agentCandidate",
    "postingScore", "postingSearch", "startup", "startupBlock", "googleAccount", "emailMessage", "job",
    "feedback", "aiUsage", "resumeAnalysis", "aiCall",
  ].map((model) => [model, { userId: true }]),
);

/**
 * Pathfinder (P0 task 4): how the connection pool behaves under load. A request waits at most
 * this long for a free connection, then fails with an error instead of hanging; a statement may
 * run at most this long in the database; idle connections are closed after a while.
 */
export const POOL_DEFAULTS = {
  /** Connections per process; each web process and worker has its own pool (PATHFINDER_DB_POOL). */
  max: 20,
  connectionTimeoutMillis: 10_000,
  statementTimeoutMillis: 30_000,
  idleTimeoutMillis: 30_000,
} as const;

/**
 * Interactive transactions (prisma.$transaction(async (tx) => ...)). Prisma's defaults (wait 2 s
 * for a connection, run 5 s) failed with P2028 under load while the pool was busy.
 */
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

/** A client for the database at `url`, with `poolSize` connections at most. */
export function createPrismaClient(url: string, poolSize: number = POOL_DEFAULTS.max): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: url,
    max: poolSize,
    connectionTimeoutMillis: POOL_DEFAULTS.connectionTimeoutMillis,
    idleTimeoutMillis: POOL_DEFAULTS.idleTimeoutMillis,
    statement_timeout: POOL_DEFAULTS.statementTimeoutMillis,
  });
  // The omit option changes the client's type parameters only; it is the same client.
  return new PrismaClient({ adapter, omit: OWNER_OMIT, transactionOptions: TRANSACTION_OPTIONS }) as unknown as PrismaClient;
}

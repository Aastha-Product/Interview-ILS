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
    "feedback", "aiUsage",
  ].map((model) => [model, { userId: true }]),
);

/** A client for the database at `url`. */
export function createPrismaClient(url: string): PrismaClient {
  // The omit option changes the client's type parameters only; it is the same client.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), omit: OWNER_OMIT }) as unknown as PrismaClient;
}

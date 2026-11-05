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

/** A client for the database at `url`. */
export function createPrismaClient(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

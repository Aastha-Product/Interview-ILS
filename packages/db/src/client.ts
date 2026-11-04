import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    // Query logging is off: queries can carry resume text.
    log: ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as { __pathfinderPrisma?: PrismaClient };

/** The process-wide raw client. Created lazily so importing this module never needs a database. */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__pathfinderPrisma) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForPrisma.__pathfinderPrisma = createPrismaClient(url);
  }
  return globalForPrisma.__pathfinderPrisma;
}

/** Test hook: point the process-wide client at another database. */
export function setPrismaForTests(client: PrismaClient): void {
  globalForPrisma.__pathfinderPrisma = client;
}

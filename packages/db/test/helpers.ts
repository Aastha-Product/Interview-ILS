import { getPrisma } from "../src/client";

/** Empties every table. Only ever runs against the _test database (see test/integration-env.ts). */
export async function resetDatabase(): Promise<void> {
  const prisma = getPrisma();
  const url = process.env.DATABASE_URL ?? "";
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("Refusing to reset a non-test database");
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "JobListing", "VerificationToken", "RateLimit" RESTART IDENTITY CASCADE',
  );
}

export async function createUser(email: string) {
  return getPrisma().user.create({ data: { email, name: email.split("@")[0] } });
}

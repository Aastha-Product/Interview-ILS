// Seeds the database. Run on every start (see Dockerfile), and by hand with:
//
//   docker/bin/yarn prisma db seed                        built-in themes
//   docker/bin/yarn prisma db seed -- --demo              plus the prototype's sample data
//   docker/bin/yarn prisma db seed -- --demo --reset      replacing an existing profile and applications
//
// Pathfinder: every profile belongs to a student, so the demo data goes to the demo student:
// demo@example.test, or the address in DEMO_EMAIL (the end-to-end tests give the one they sign in
// as), created if there isn't one. Signing in with that address then shows it. Running it again
// leaves a demo student who already has data as they are, unless --reset is given.

import { createPrismaClient } from "@/lib/database";

import { seedBuiltIns } from "./seed/built-ins";
import { DemoRefused, seedDemoStudent } from "./seed/demo";

const KNOWN_FLAGS = new Set(["--demo", "--reset"]);

async function main() {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) {
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`Unknown option ${flag}. Use --demo, optionally with --reset.`);
  }
  if (flags.has("--reset") && !flags.has("--demo")) throw new Error("--reset only works together with --demo.");

  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  try {
    await seedBuiltIns(db);
    console.log("Seeded the built-in themes.");

    if (flags.has("--demo")) {
      const demo = await seedDemoStudent(db, { email: process.env.DEMO_EMAIL?.trim() || undefined, reset: flags.has("--reset") });
      console.log(
        demo.skipped
          ? `${demo.email} already has a profile or applications: left as they are. Add --reset to replace them with the demo data.`
          : `Loaded the demo data for ${demo.email}: Jane Doe's profile and ${demo.applications} applications.`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof DemoRefused ? error.message : error);
  process.exitCode = 1;
});

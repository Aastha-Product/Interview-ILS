// Seeds the database. Run on every start (see Dockerfile), and by hand with:
//
//   docker/bin/yarn prisma db seed                        built-in themes
//   docker/bin/yarn prisma db seed -- --demo              plus the prototype's sample data
//   docker/bin/yarn prisma db seed -- --demo --reset      replacing an existing profile and applications
//
// Pathfinder: every profile belongs to a student, so the demo data goes to the student with the
// address in DEMO_EMAIL (jane.doe@example.com by default, whom the end-to-end tests sign in as),
// created if there isn't one. Signing in with that address then shows it.

import { createPrismaClient } from "@/lib/database";
import { scopedClient } from "@/lib/owner/scope";

import { seedBuiltIns } from "./seed/built-ins";
import { DemoRefused, seedDemo } from "./seed/demo";

const KNOWN_FLAGS = new Set(["--demo", "--reset"]);
const DEMO_EMAIL = "jane.doe@example.com";

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
      const email = (process.env.DEMO_EMAIL?.trim() || DEMO_EMAIL).toLowerCase();
      const student = await db.user.upsert({ where: { email }, update: {}, create: { email, name: "Jane Doe" }, select: { id: true } });
      const { applications } = await seedDemo(scopedClient(db, async () => student.id), { reset: flags.has("--reset") });
      console.log(`Loaded the demo data for ${email}: Jane Doe's profile and ${applications} applications.`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof DemoRefused ? error.message : error);
  process.exitCode = 1;
});

// Adds the demo data (packages/core/src/demo/seed.ts) to one account:
//
//   pnpm db:seed                          development: demo@example.test (sign in with Dev sign-in)
//   pnpm db:seed -- --email you@gmail.com staging: an account that has signed in once with Google
//
// Uses the mock AI whatever the keys say, so it costs nothing and gives the same result every time.
// Refused when APP_ENV=production.
import "./env";
import { createAiClient, createMockProvider } from "@pathfinder/ai";
import { getConfig, seedDemoData, stopBoss, UserFacingError } from "@pathfinder/core";
import { ensureLocalUser, findUserIdByEmail, scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";

const DEFAULT_EMAIL = "demo@example.test";

async function main(): Promise<number> {
  const config = getConfig();
  if (config.APP_ENV === "production") {
    process.stderr.write("Demo data is never added in production (APP_ENV=production).\n");
    return 2;
  }
  const flag = process.argv.indexOf("--email");
  const email = (flag >= 0 ? process.argv[flag + 1] : undefined) ?? (config.APP_ENV === "development" ? DEFAULT_EMAIL : undefined);
  if (!email) {
    process.stderr.write("On staging, pass the email of an account that has signed in once: pnpm db:seed -- --email you@example.com\n");
    return 2;
  }

  let userId: string | null;
  if (config.APP_ENV === "development") {
    userId = await ensureLocalUser(email);
  } else {
    userId = await findUserIdByEmail(email);
    if (!userId) {
      process.stderr.write(`No account for ${email}. Sign in to Pathfinder once with it, then run this again.\n`);
      return 2;
    }
  }

  const ai = createAiClient({ provider: createMockProvider() });
  try {
    const result = await seedDemoData({ db: scopedDb(userId), ai }, { queuePdfs: true });
    process.stdout.write(
      `Added demo data for ${email}: ${result.jobs} jobs, ${result.applications} applications, ${result.drafted} drafts ` +
        `(${result.pdfsQueued} PDFs will render when the worker runs).\n`,
    );
    if (config.APP_ENV === "development") process.stdout.write(`Sign in with Dev sign-in as ${email} to see it.\n`);
    return 0;
  } catch (error) {
    if (error instanceof UserFacingError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

main()
  .then((code) => (process.exitCode = code))
  .catch((error: Error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopBoss();
    await getPrisma().$disconnect();
  });

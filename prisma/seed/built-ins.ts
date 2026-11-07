import type { PrismaClient } from "@/generated/prisma/client";
import { rawClientOf } from "@/lib/owner/scope";
import { BUILT_IN_THEMES } from "@/lib/themes";

/**
 * Creates what every installation needs: the built-in themes. Safe to run on
 * every start: they're kept in sync with BUILT_IN_THEMES (src/lib/themes.ts).
 * An empty profile and default settings need no rows.
 */
export async function seedBuiltIns(client: PrismaClient): Promise<void> {
  // Pathfinder (private accounts): built-in themes are shared and have no owner, so they're
  // always written through the unscoped client, whichever client the caller has.
  const db = rawClientOf(client);
  await db.$transaction(
    BUILT_IN_THEMES.map(({ id, ...theme }) =>
      db.theme.upsert({ where: { id }, create: { id, ...theme }, update: theme }),
    ),
  );
}

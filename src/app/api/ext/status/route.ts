import { NextResponse } from "next/server";

import { ApplyState } from "@/generated/prisma/enums";
import { loadAutoApply } from "@/lib/apply/settings";
import { extensionRoute } from "@/lib/extension/route";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

/** Pathfinder (step 5): what the extension's popup shows: who it's connected to, and whether there's work. */
export const GET = extensionRoute(async () => {
  const [name, settings, ready] = await Promise.all([loadProfileName(), loadAutoApply(), prisma.applyTask.count({ where: { state: ApplyState.READY } })]);
  return NextResponse.json({ name, enabled: settings.enabled, dryRun: settings.dryRun, ready });
});

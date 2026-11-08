import { vi } from "vitest";

// Tests run outside a request, so there's no session to name the student. Code acts for
// the student set with runAsUser, or else for the test student (see src/test/db.ts).
vi.mock("@/lib/owner/current", async () => {
  const { contextUserId } = await import("@/lib/owner/context");
  return { currentUserId: async () => contextUserId() ?? "test-student" };
});

// Pathfinder: the inherited tests check Dossier's self-hosted behaviour, where each user brings
// their own provider and keys. Managed mode (the default in production) has its own tests, which
// turn it on with vi.stubEnv("PATHFINDER_MANAGED", "on").
process.env.PATHFINDER_MANAGED ??= "off";

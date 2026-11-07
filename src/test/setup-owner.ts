import { vi } from "vitest";

// Tests run outside a request, so there's no session to name the student. Code acts for
// the student set with runAsUser, or else for the test student (see src/test/db.ts).
vi.mock("@/lib/owner/current", async () => {
  const { contextUserId } = await import("@/lib/owner/context");
  return { currentUserId: async () => contextUserId() ?? "test-student" };
});

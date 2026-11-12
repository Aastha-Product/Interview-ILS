import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";

// Pathfinder v1 plan, task 3: someone who signs in for the first time lands in an app that works
// straight away, as Dossier's single-user first run does. A new student has no rows of their own:
// the defaults come from the code, and the built-in themes are everyone's. What one student then
// changes stays theirs.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));

const { studentForFirebase } = await import("@/lib/auth/students");
const { loadSettings, saveSettings } = await import("@/lib/settings-data");
const { DEFAULT_BASE_THEME, settingsFromRows } = await import("@/lib/settings");
const { loadThemes, loadTheme } = await import("@/lib/theme-data");
const { loadProfile } = await import("@/lib/profile-data");
const { loadAutoApply } = await import("@/lib/apply/settings");
const { EMPTY_ANSWERS } = await import("@/lib/apply/answers");

const prisma = () => db.client!;
const raw = () => rawClientOf(prisma());
/** Signs someone in for the first time, as the sign-in page does, and returns their student id. */
const firstSignIn = (name: string) => studentForFirebase({ uid: `uid-${name}`, email: `${name}@example.test`, emailVerified: true, name }, raw());

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
});
afterAll(() => prisma().$disconnect());

describe("a brand-new student (Pathfinder v1 plan, task 3)", () => {
  it("starts with the default settings, the built-in themes, an empty profile and auto-apply off", async () => {
    const asha = await firstSignIn("asha");
    await runAsUser(asha, async () => {
      // No rows of their own are needed for any of it.
      expect(await prisma().setting.count()).toBe(0);
      const settings = await loadSettings();
      expect(settings).toEqual(settingsFromRows([]));
      // The base resume has a theme that exists.
      expect(settings.baseThemeId).toBe(DEFAULT_BASE_THEME);
      expect(await loadTheme(DEFAULT_BASE_THEME)).toMatchObject({ id: DEFAULT_BASE_THEME, builtIn: true });
      const themes = await loadThemes();
      expect(themes).toHaveLength(12);
      expect(themes.every((theme) => theme.builtIn)).toBe(true);

      const profile = await loadProfile();
      expect(profile).toMatchObject({ photo: null, skills: [], languages: [], experience: [], projects: [], education: [], publications: [], references: [], facts: [] });
      expect(Object.values(profile.basics).filter((value) => typeof value === "string" && value !== "")).toEqual([]);
      expect(await prisma().application.count()).toBe(0);

      // Auto-apply is off, a dry run, not agreed to, and says what it needs first.
      const autoApply = await loadAutoApply();
      expect(autoApply).toMatchObject({ enabled: false, consented: false, dryRun: true, preferences: null, answers: EMPTY_ANSWERS });
      expect(autoApply.missing.length).toBeGreaterThan(0);
    });
    // Their name from sign-in is kept with the account.
    expect(await raw().user.findUniqueOrThrow({ where: { id: asha } })).toMatchObject({ email: "asha@example.test", name: "asha" });
  });

  it("gets the same defaults after another student has changed theirs, and changes only their own", async () => {
    const asha = await firstSignIn("asha");
    await runAsUser(asha, async () => {
      await saveSettings({ paper: "LETTER", strict: false });
      await prisma().theme.create({ data: { id: "ashas", name: "Asha's", headFont: "GEIST", bodyFont: "GEIST", accent: "#224466" } });
      await saveSettings({ baseThemeId: "ashas" });
      await prisma().profileField.create({ data: { key: "name", value: "Asha Rao" } });
    });

    const ravi = await firstSignIn("ravi");
    expect(ravi).not.toBe(asha);
    await runAsUser(ravi, async () => {
      expect(await loadSettings()).toEqual(settingsFromRows([]));
      // The built-in themes, and not Asha's own.
      expect((await loadThemes()).map((theme) => theme.id)).not.toContain("ashas");
      expect(await loadThemes()).toHaveLength(12);
      expect((await loadProfile()).basics.name).toBe("");
      await saveSettings({ paper: "A4", strict: true });
    });

    // Asha's are as she left them.
    await runAsUser(asha, async () => {
      expect(await loadSettings()).toMatchObject({ paper: "LETTER", strict: false, baseThemeId: "ashas" });
      expect(await loadThemes()).toHaveLength(13);
      expect((await loadProfile()).basics.name).toBe("Asha Rao");
    });
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { unitsSchema, matchSchema, matchScore } from "@/lib/application-data";
import { basicsFromFields } from "@/lib/profile";
import { advance, type StatusFields } from "@/lib/status";
import { BUILT_IN_THEMES } from "@/lib/themes";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";
import { CURRENT_USER } from "@/lib/owner/scope";

import { seedBuiltIns } from "./built-ins";
import { runAsUser } from "@/lib/owner/context";

import { DEMO_EMAIL, DemoRefused, seedDemo, seedDemoStudent } from "./demo";

const db = createTestClient();
const now = new Date("2026-10-10T08:00:00Z");
const DAY = 86_400_000;
const basics = async () => basicsFromFields(await db.profileField.findMany());

beforeEach(async () => {
  await resetDatabase(db);
  await seedBuiltIns(db);
});
afterAll(() => db.$disconnect());

describe("built-in seed", () => {
  it("creates the twelve themes and nothing else", async () => {
    expect(await db.theme.findMany({ orderBy: { id: "asc" }, select: { id: true, builtIn: true } })).toEqual(
      ["atlas", "chronicle", "classic", "console", "editorial", "folio", "ledger", "minimal", "modern", "signal", "studio", "technical"].map((id) => ({ id, builtIn: true })),
    );
    // An empty profile and default settings are empty tables.
    expect(await db.profileField.count()).toBe(0);
    expect(await db.setting.count()).toBe(0);
    expect(await db.application.count()).toBe(0);
    expect(BUILT_IN_THEMES).toHaveLength(12);
  });

  it("is safe to run again: it keeps the user's data and restores changed built-in themes", async () => {
    await db.profileField.create({ data: { key: "name", value: "Me" } });
    await db.setting.create({ data: { key: "paper", value: "LETTER" } });
    await db.theme.create({ data: { name: "Mine", headFont: "GEIST", bodyFont: "GEIST", accent: "#000000" } });
    await rawClientOf(db).theme.update({ where: { id: "classic" }, data: { accent: "#ff0000", headerStyle: "BANNER", dateStyle: "TIMELINE" } });

    await seedBuiltIns(db);

    expect((await basics()).name).toBe("Me");
    expect((await db.setting.findUniqueOrThrow({ where: { userId_key: { userId: CURRENT_USER, key: "paper" } } })).value).toBe("LETTER");
    expect(await db.theme.count()).toBe(13);
    expect(await db.theme.findUniqueOrThrow({ where: { id: "classic" } })).toMatchObject({ accent: "#1d1c1a", headerStyle: "PLAIN", dateStyle: "INLINE" });
  });
});

describe("demo seed", () => {
  it("loads Jane Doe's profile", async () => {
    await seedDemo(db, { now });
    expect(await basics()).toMatchObject({
      name: "Jane Doe",
      headline: "Senior Product Designer",
      dob: "1992-04-18",
      city: "Rotterdam",
      showAge: false,
    });
    const counts = await Promise.all([
      db.experience.count(),
      db.education.count(),
      db.skill.count(),
      db.language.count(),
      db.reference.count(),
    ]);
    expect(counts).toEqual([3, 2, 7, 3, 1]);

    const northwind = await db.experience.findFirstOrThrow({
      where: { company: "Northwind Logistics" },
      include: { skills: { include: { skill: true } } },
    });
    expect(northwind).toMatchObject({ startYear: 2021, startMonth: 3, current: true, endYear: null });
    expect(northwind.skills.map((link) => link.skill.name).sort()).toEqual([
      "Design systems",
      "Interaction design",
      "User research",
      "Workshop facilitation",
    ]);
    expect(await db.education.findFirstOrThrow({ where: { school: "TU Delft" } })).toMatchObject({
      startYear: 2013,
      startMonth: null,
      endYear: 2015,
    });
  });

  it("loads nine applications whose status history matches their funnel fields", async () => {
    await seedDemo(db, { now });
    const applications = await db.application.findMany({
      include: { events: { orderBy: { at: "asc" } } },
    });
    expect(applications).toHaveLength(9);

    for (const application of applications) {
      let replayed: StatusFields = { status: "DRAFT", furthestStage: null, sentAt: null };
      for (const event of application.events) {
        expect(event.from).toBe(replayed.status);
        replayed = advance(replayed, event.to, event.at)!.update;
      }
      expect(replayed).toEqual({
        status: application.status,
        furthestStage: application.furthestStage,
        sentAt: application.sentAt,
      });
    }

    const byCompany = new Map(applications.map((application) => [application.company, application]));
    expect(byCompany.get("Parcelhub")).toMatchObject({ status: "REJECTED", furthestStage: "SCREENING" });
    expect(byCompany.get("Quill & Co")).toMatchObject({ status: "DECLINED", furthestStage: "OFFER" });
    expect(byCompany.get("Brightline Transit")).toMatchObject({ status: "DRAFT", furthestStage: null, sentAt: null });
    expect(byCompany.get("Ledgerly")).toMatchObject({ status: "DRAFT" });
  });

  it("dates everything relative to when it runs", async () => {
    await seedDemo(db, { now });
    const oaken = await db.application.findFirstOrThrow({ where: { company: "Oaken Studio" } });
    expect(oaken.sentAt).toEqual(new Date(now.getTime() - 40 * DAY));
    expect(oaken.updatedAt).toEqual(new Date(now.getTime() - 3 * DAY));
    // "Apply by 3 Oct" was six days after the prototype's 27 September.
    const brightline = await db.application.findFirstOrThrow({ where: { company: "Brightline Transit" } });
    expect(brightline.deadline?.toISOString().slice(0, 10)).toBe("2026-10-16");
  });

  it("gives the Ledgerly draft its match, documents and opening message", async () => {
    await seedDemo(db, { now });
    const ledgerly = await db.application.findFirstOrThrow({
      where: { company: "Ledgerly" },
      include: { documents: true, messages: true },
    });
    expect(matchScore(matchSchema.parse(ledgerly.match))).toEqual({ hit: 5, total: 7 });

    const units = (kind: string) => unitsSchema.parse(ledgerly.documents.find((document) => document.kind === kind)?.units);
    const [resume, letter] = [units("RESUME"), units("COVER_LETTER")];
    expect(resume.map((unit) => unit.label)).toEqual([
      "Summary",
      "Northwind Logistics role",
      "Fieldnote role",
      "Studio Brik role",
      "Tidewater design tokens project",
      "Skills",
      "MSc Design for Interaction",
      "BA Communication Design",
      "Publication “Doe, J., & Vermeer, K. (2016). Trust in…”",
      "Languages",
    ]);
    const [publication] = await db.publication.findMany();
    expect(resume.find((unit) => unit.id === `publication:${publication.id}`)?.text).toBe(publication.citation);
    expect(resume.find((unit) => unit.id === "skills")?.text).toMatch(/^Design systems · User research · Figma · /);
    const [project] = await db.project.findMany({ include: { skills: { include: { skill: true } } } });
    expect(resume.find((unit) => unit.id === `project:${project.id}`)?.text).toBe(project.bullets);
    expect(project.skills.map((link) => link.skill.name).sort()).toEqual(["Design systems", "Figma", "HTML & CSS"]);
    const education = await db.education.findMany();
    expect(resume.filter((unit) => unit.id.startsWith("education:")).map((unit) => unit.id).sort()).toEqual(
      education.map((entry) => `education:${entry.id}`).sort(),
    );
    expect(letter).toHaveLength(4);
    expect(ledgerly.messages[0].text).toMatch(/^Here's what I tailored for Ledgerly:\n\n- Rewrote/);
  });

  it("refuses to replace the user's data unless asked to reset", async () => {
    await db.profileField.create({ data: { key: "name", value: "Me" } });
    await expect(seedDemo(db, { now })).rejects.toBeInstanceOf(DemoRefused);
    expect(await db.application.count()).toBe(0);

    await seedDemo(db, { now, reset: true });
    await seedDemo(db, { now, reset: true });
    expect(await db.application.count()).toBe(9);
    expect(await db.skill.count()).toBe(7);
    expect((await basics()).name).toBe("Jane Doe");
  });
});

describe("the demo student (Pathfinder v1 plan, task 4)", () => {
  const raw = () => rawClientOf(db);

  it("gets the demo data as its own student, and no real student's data is touched", async () => {
    // A real student with data of their own (the test student), and another with none.
    await db.profileField.create({ data: { key: "name", value: "A real student" } });
    await db.application.create({ data: { company: "Theirs" } });
    await raw().user.create({ data: { id: "another", email: "another@example.test" } });

    const demo = await seedDemoStudent(raw(), { now });
    expect(demo).toMatchObject({ email: DEMO_EMAIL, applications: 9, skipped: false });
    expect(DEMO_EMAIL).toBe("demo@example.test");
    expect(await raw().user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } })).toMatchObject({ id: demo.userId, name: "Jane Doe" });

    // Everything it added is the demo student's.
    expect(await raw().application.count({ where: { userId: demo.userId } })).toBe(9);
    expect(await raw().application.count()).toBe(10);
    await runAsUser(demo.userId, async () => {
      expect((await basics()).name).toBe("Jane Doe");
      expect(await db.application.count()).toBe(9);
    });
    // The real students are as they were.
    expect((await basics()).name).toBe("A real student");
    expect((await db.application.findMany()).map((application) => application.company)).toEqual(["Theirs"]);
    await runAsUser("another", async () => {
      expect(await db.profileField.count()).toBe(0);
      expect(await db.application.count()).toBe(0);
    });
  });

  it("is safe to run twice: the second run changes nothing, and --reset loads it afresh", async () => {
    const first = await seedDemoStudent(raw(), { now });
    await runAsUser(first.userId, () => db.application.deleteMany({ where: { company: "Ledgerly" } }));

    const second = await seedDemoStudent(raw(), { now });
    expect(second).toMatchObject({ userId: first.userId, skipped: true, applications: 0 });
    expect(await raw().user.count({ where: { email: DEMO_EMAIL } })).toBe(1);
    expect(await raw().application.count({ where: { userId: first.userId } })).toBe(8);

    expect(await seedDemoStudent(raw(), { now, reset: true })).toMatchObject({ userId: first.userId, skipped: false, applications: 9 });
    expect(await raw().application.count({ where: { userId: first.userId } })).toBe(9);
  });

  it("goes to another address when one is given, as the end-to-end tests do", async () => {
    const demo = await seedDemoStudent(raw(), { email: " Jane.Doe@Example.com ", now });
    expect(demo.email).toBe("jane.doe@example.com");
    expect(await raw().user.count({ where: { email: DEMO_EMAIL } })).toBe(0);
  });
});

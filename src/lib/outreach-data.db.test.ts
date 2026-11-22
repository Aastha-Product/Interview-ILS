import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

// Recruiter outreach (Phase 3) against the test database, with Gmail's sending faked.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_DATA_DIR: "/tmp" } }));
const ai = vi.hoisted(() => ({ provider: undefined as unknown, ready: true }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ai.provider }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => ai.ready }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
const gmail = vi.hoisted(() => ({ sent: [] as { mail: Record<string, unknown>; threadId?: string }[] }));
vi.mock("@/lib/google/gmail", () => ({
  sendMail: async (mail: Record<string, unknown>, { threadId }: { threadId?: string } = {}) => {
    gmail.sent.push({ mail, threadId });
    return { id: `msg-${gmail.sent.length}`, threadId: threadId ?? "thread-1" };
  },
}));

const { draftOutreach, loadOutreach, loadOutreachList, OutreachError, saveOutreach, sendOutreach, sentInLastDay } = await import("./outreach-data");
const { OUTREACH_PER_DAY } = await import("./outreach");

const prisma = () => db.client!;
const now = new Date("2026-11-22T10:00:00Z");
const daysLater = (days: number) => new Date(now.getTime() + days * 86_400_000);

beforeEach(async () => {
  await resetDatabase(prisma());
  gmail.sent = [];
  ai.ready = true;
  ai.provider = new MockProvider({ reply: () => ({ subject: "Applied for Analyst", body: "Hi Priya,\n\nI applied.\n\nJane", linkedinNote: "Hi Priya, I applied." }) });
  await prisma().application.create({
    data: { id: "groww", company: "Groww", role: "Data Analyst", status: "SENT", sentAt: now, postingText: "Questions? priya@groww.in. Privacy: privacy@groww.in", postingUrl: "https://jobs.example/groww" },
  });
  await prisma().application.create({ data: { id: "draft", company: "Zeta", role: "Designer", status: "DRAFT" } });
  await prisma().application.create({ data: { id: "old", company: "Acme", role: "Engineer", status: "REJECTED" } });
});
afterAll(() => db.client!.$disconnect());

const connectGmail = () => prisma().googleAccount.create({ data: { email: "jane@gmail.com", refreshTokenEnc: "x", scopes: "openid email https://www.googleapis.com/auth/gmail.send" } });

describe("recruiter outreach (Phase 3)", () => {
  it("lists open, sent applications only, each with where its outreach stands", async () => {
    const rows = await loadOutreachList(now);
    expect(rows).toEqual([{ applicationId: "groww", company: "Groww", role: "Data Analyst", contact: "", stage: "none", sentAt: null }]);
  });

  it("offers the posting's addresses and keeps the student's edits", async () => {
    const view = await loadOutreach("groww", now);
    expect(view).toMatchObject({ company: "Groww", role: "Data Analyst", postingUrl: "https://jobs.example/groww", suggestions: ["priya@groww.in"], stage: "none", sentToday: 0 });

    await saveOutreach("groww", { contactName: " Priya ", contactEmail: " Priya@Groww.in ", subject: "Applied\nfor it", body: "Hi", linkedinNote: "Note" });
    expect(await loadOutreach("groww", now)).toMatchObject({ contactName: "Priya", contactEmail: "priya@groww.in", subject: "Applied for it", body: "Hi", linkedinNote: "Note", stage: "draft" });
    await expect(saveOutreach("groww", { contactEmail: "not an address" })).rejects.toThrow(OutreachError);
    await expect(loadOutreach("missing", now)).rejects.toThrow("no longer exists");
  });

  it("drafts with AI, sends from Gmail, then follows up once in the same thread", async () => {
    await expect(sendOutreach("groww", now)).rejects.toThrow("Connect your Google account");
    await connectGmail();
    await expect(sendOutreach("groww", now)).rejects.toThrow("Write the email first");

    expect(await draftOutreach("groww")).toBe("first");
    await expect(sendOutreach("groww", now)).rejects.toThrow("recruiter's email address");
    await saveOutreach("groww", { contactName: "Priya", contactEmail: "priya@groww.in" });

    expect(await sendOutreach("groww", now)).toBe("first");
    expect(gmail.sent[0]).toMatchObject({ mail: { to: "Priya <priya@groww.in>", subject: "Applied for Analyst", from: "jane@gmail.com" }, threadId: undefined });
    const mail = await prisma().emailMessage.findFirstOrThrow({ where: { applicationId: "groww" } });
    expect(mail).toMatchObject({ threadId: "thread-1", direction: "OUTGOING", toAddress: "Priya <priya@groww.in>" });
    expect(await sentInLastDay(now)).toBe(1);

    // Sent: the first email can't change, and the follow-up isn't due yet.
    await saveOutreach("groww", { subject: "Changed" });
    expect((await loadOutreach("groww", daysLater(1))).subject).toBe("Applied for Analyst");
    expect((await loadOutreachList(daysLater(1)))[0].stage).toBe("sent");
    expect((await loadOutreachList(daysLater(8)))[0]).toMatchObject({ stage: "follow-up-due", contact: "Priya" });

    ai.provider = new MockProvider({ reply: () => ({ body: "Hi Priya, following up." }) });
    expect(await draftOutreach("groww")).toBe("follow-up");
    expect(await sendOutreach("groww", daysLater(8))).toBe("follow-up");
    expect(gmail.sent[1]).toMatchObject({ mail: { subject: "Re: Applied for Analyst", body: "Hi Priya, following up." }, threadId: "thread-1" });
    expect((await loadOutreach("groww", daysLater(8))).stage).toBe("followed-up");
    await expect(sendOutreach("groww", daysLater(8))).rejects.toThrow("both gone out");
    await expect(draftOutreach("groww")).rejects.toThrow("gone out already");

    // A reply in the thread ends it.
    await prisma().emailMessage.create({ data: { gmailId: "in-1", threadId: "thread-1", applicationId: "groww", direction: "INCOMING", sentAt: daysLater(9) } });
    expect((await loadOutreachList(daysLater(9)))[0].stage).toBe("replied");
  });

  it("drafts only with an AI provider", async () => {
    ai.ready = false;
    await expect(draftOutreach("groww")).rejects.toThrow("needs an AI provider");
  });

  it("sends at most a day's worth of recruiter emails", async () => {
    await connectGmail();
    for (let index = 0; index < OUTREACH_PER_DAY; index++) {
      const id = `app-${index}`;
      await prisma().application.create({ data: { id, company: `Co ${index}`, role: "Analyst", status: "SENT" } });
      await prisma().outreach.create({ data: { applicationId: id, contactEmail: "hr@co.in", subject: "s", body: "b", sentAt: now, threadId: `t-${index}` } });
    }
    await saveOutreach("groww", { contactEmail: "priya@groww.in", subject: "Applied", body: "Hi" });
    await expect(sendOutreach("groww", now)).rejects.toThrow(`${OUTREACH_PER_DAY} recruiter emails`);
    expect(gmail.sent).toHaveLength(0);
  });
});

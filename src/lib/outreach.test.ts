import { describe, expect, it } from "vitest";

import { LINKEDIN_NOTE_MAX, linkedinNote, linkedinSearchUrl, outreachStage, postingContacts, recipientLine, sendProblem } from "./outreach";

describe("recruiter outreach (Phase 3)", () => {
  it("offers only addresses the posting gives that could be a person to write to", () => {
    const posting = `Questions? Write to Priya.Sharma@Acme.in or careers@acme.in.
      Privacy: privacy@acme.in. Need adjustments? accommodations@acme.in. Don't reply to noreply@acme.in or no-reply@acme.in.
      Sample: you@example.com. Again: careers@acme.in`;
    expect(postingContacts(posting)).toEqual(["priya.sharma@acme.in", "careers@acme.in"]);
    expect(postingContacts("a@x.io b@x.io c@x.io", 2)).toEqual(["a@x.io", "b@x.io"]);
    expect(postingContacts("No addresses here.")).toEqual([]);
  });

  it("links to LinkedIn's people search for the company's recruiters", () => {
    expect(linkedinSearchUrl("Acme & Co")).toBe("https://www.linkedin.com/search/results/people/?keywords=Acme%20%26%20Co%20recruiter");
    expect(linkedinSearchUrl("  ")).toBe("https://www.linkedin.com/search/results/people/?keywords=recruiter");
  });

  it("writes the recipient with a name when there is one", () => {
    expect(recipientLine(' Priya "P" <Sharma> ', "priya@acme.in ")).toBe("Priya P Sharma <priya@acme.in>");
    expect(recipientLine("", "priya@acme.in")).toBe("priya@acme.in");
  });

  it("keeps a LinkedIn note to one paragraph within LinkedIn's limit", () => {
    expect(linkedinNote("  Hi there,\n\nI applied.  ")).toBe("Hi there, I applied.");
    const long = linkedinNote("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(LINKEDIN_NOTE_MAX);
    expect(long.endsWith("word…")).toBe(true);
  });

  it("says where an outreach stands", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const email = { subject: "Applied", body: "Hi", sentAt: null, followUpSentAt: null };
    expect(outreachStage(null, false, now, 7)).toBe("none");
    expect(outreachStage({ ...email, subject: " ", body: "" }, false, now, 7)).toBe("none");
    expect(outreachStage(email, false, now, 7)).toBe("draft");
    expect(outreachStage({ ...email, sentAt: daysAgo(2) }, false, now, 7)).toBe("sent");
    expect(outreachStage({ ...email, sentAt: daysAgo(7) }, false, now, 7)).toBe("follow-up-due");
    expect(outreachStage({ ...email, sentAt: daysAgo(9), followUpSentAt: daysAgo(1) }, false, now, 7)).toBe("followed-up");
    expect(outreachStage({ ...email, sentAt: daysAgo(9), followUpSentAt: daysAgo(1) }, true, now, 7)).toBe("replied");
  });

  it("says what's missing before an email can go out", () => {
    const ready = { contactEmail: "priya@acme.in", subject: "Applied", body: "Hi Priya" };
    expect(sendProblem(ready)).toBeNull();
    expect(sendProblem({ ...ready, contactEmail: "" })).toMatch(/email address/);
    expect(sendProblem({ ...ready, contactEmail: "a@x.io, b@x.io" })).toMatch(/email address/);
    expect(sendProblem({ ...ready, subject: " " })).toMatch(/subject/);
    expect(sendProblem({ ...ready, body: "" })).toMatch(/message/);
    expect(sendProblem({ ...ready, body: "I led [...] projects" })).toMatch(/\[…\]/);
  });
});

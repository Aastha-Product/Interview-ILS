import { emailAddresses } from "@/lib/application-email";

// Pathfinder (Phase 3): recruiter outreach. After applying, the student can email the recruiter or
// hiring manager: the AI drafts it, the student checks it and sends it from their own Gmail, and
// a reply in its thread counts as the recruiter's answer. LinkedIn is never automated: the student
// gets a short note to copy and a search to open in their own browser.

/** At most this many outreach emails (first emails and follow-ups) a student sends a day. */
export const OUTREACH_PER_DAY = 20;

/** LinkedIn's limit for a note with a connection request. */
export const LINKEDIN_NOTE_MAX = 300;

/** The longest subject and message kept. */
export const SUBJECT_MAX = 200;
export const BODY_MAX = 4000;

/** Addresses in a posting that are never a person to write to about a job. */
const NOT_A_CONTACT = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|privacy|gdpr|dpo|data-?protection|legal|unsubscribe|abuse|security|webmaster|postmaster|accommodations?|accessibility)@/i;
const PLACEHOLDER = /@(example\.(com|org|net)|domain\.com|email\.com)$/i;

/**
 * The addresses a posting gives that could be a recruiter's or the hiring team's, in the order it
 * gives them: never no-reply, privacy or accommodation addresses. Pathfinder never guesses an
 * address; any other comes from the student.
 */
export function postingContacts(text: string, limit = 5): string[] {
  return emailAddresses(text)
    .map((address) => address.replace(/[.)]+$/, "").toLowerCase())
    .filter((address, index, all) => all.indexOf(address) === index && !NOT_A_CONTACT.test(address) && !PLACEHOLDER.test(address))
    .slice(0, limit);
}

/** LinkedIn's people search for the company's recruiters, for the student to open themself. */
export function linkedinSearchUrl(company: string): string {
  const keywords = `${company.trim()} recruiter`.trim();
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

/** "Jane Doe <jane@acme.com>", or just the address. */
export function recipientLine(name: string, address: string): string {
  const clean = name.trim().replace(/[<>"]/g, "");
  return clean ? `${clean} <${address.trim()}>` : address.trim();
}

/** The note as LinkedIn takes it: one paragraph, within its limit, cut at a word. */
export function linkedinNote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= LINKEDIN_NOTE_MAX) return flat;
  const cut = flat.slice(0, LINKEDIN_NOTE_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), LINKEDIN_NOTE_MAX - 40)).trim()}…`;
}

export type OutreachStage = "none" | "draft" | "sent" | "follow-up-due" | "followed-up" | "replied";

export const STAGE_LABELS: Record<OutreachStage, string> = {
  none: "Not started",
  draft: "Draft",
  sent: "Sent, waiting",
  "follow-up-due": "Follow-up due",
  "followed-up": "Followed up",
  replied: "Replied",
};

type OutreachState = { subject: string; body: string; sentAt: Date | null; followUpSentAt: Date | null } | null;

/**
 * Where the outreach for an application stands: a reply ends it; after `quietDays` without one, a
 * single follow-up is due.
 */
export function outreachStage(outreach: OutreachState, replied: boolean, now: Date, quietDays: number): OutreachStage {
  if (!outreach) return "none";
  if (!outreach.sentAt) return outreach.subject.trim() || outreach.body.trim() ? "draft" : "none";
  if (replied) return "replied";
  if (outreach.followUpSentAt) return "followed-up";
  const quietFor = (now.getTime() - outreach.sentAt.getTime()) / 86_400_000;
  return quietFor >= quietDays ? "follow-up-due" : "sent";
}

/** What's wrong with an email before it can go out, or null when it's ready. */
export function sendProblem({ contactEmail, subject, body }: { contactEmail: string; subject: string; body: string }): string | null {
  if (emailAddresses(contactEmail).length !== 1) return "Add the recruiter's email address first.";
  if (!subject.trim()) return "Add a subject first.";
  if (!body.trim()) return "Write the message first.";
  if (/\[…\]|\[\.\.\.\]/.test(body)) return "Fill in the parts marked […] first.";
  return null;
}

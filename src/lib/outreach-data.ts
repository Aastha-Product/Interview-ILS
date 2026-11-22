import "server-only";

import { ApplicationStatus, EmailDirection } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { writeFollowUp, writeOutreach } from "@/lib/ai/tasks/write-outreach";
import { emailAddresses } from "@/lib/application-email";
import { loadGoogleAccount } from "@/lib/google/account";
import { sendMail } from "@/lib/google/gmail";
import { replySubject } from "@/lib/google/send";
import { CURRENT_USER } from "@/lib/owner/scope";
import { prisma, systemPrisma } from "@/lib/prisma";
import { loadProfile, loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

import { BODY_MAX, LINKEDIN_NOTE_MAX, linkedinNote, OUTREACH_PER_DAY, outreachStage, postingContacts, recipientLine, sendProblem, SUBJECT_MAX, type OutreachStage } from "./outreach";

// Pathfinder (Phase 3): recruiter outreach's reads and writes. Every email goes out only when the
// student sends it, from their own Gmail, at most OUTREACH_PER_DAY a day.

/** Applications worth writing to a recruiter about: sent and still open. */
const OPEN: ApplicationStatus[] = [ApplicationStatus.SENT, ApplicationStatus.SCREENING, ApplicationStatus.INTERVIEW];

export class OutreachError extends Error {}

export type OutreachRow = {
  applicationId: string;
  company: string;
  role: string;
  contact: string;
  stage: OutreachStage;
  sentAt: Date | null;
};

/** Whether a reply came in any thread an outreach email went out in, by application. */
async function repliedThreads(threads: string[]): Promise<Set<string>> {
  if (threads.length === 0) return new Set();
  const replies = await prisma.emailMessage.findMany({
    where: { threadId: { in: threads }, direction: EmailDirection.INCOMING },
    select: { threadId: true },
    distinct: ["threadId"],
  });
  return new Set(replies.map((reply) => reply.threadId));
}

/** Outreach: every open application, with where its recruiter email stands; due follow-ups first. */
export async function loadOutreachList(now: Date = new Date()): Promise<OutreachRow[]> {
  const [applications, settings] = await Promise.all([
    prisma.application.findMany({
      where: { archivedAt: null, awaitingReview: false, status: { in: OPEN } },
      select: { id: true, company: true, role: true, title: true, sentAt: true, updatedAt: true, outreach: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    loadSettings(),
  ]);
  const replied = await repliedThreads(applications.flatMap((application) => (application.outreach?.threadId ? [application.outreach.threadId] : [])));
  const order: Record<OutreachStage, number> = { "follow-up-due": 0, draft: 1, none: 2, sent: 3, "followed-up": 4, replied: 5 };
  return applications
    .map((application) => {
      const outreach = application.outreach;
      return {
        applicationId: application.id,
        company: application.company,
        role: application.role || application.title,
        contact: outreach?.contactName || outreach?.contactEmail || "",
        stage: outreachStage(outreach, Boolean(outreach?.threadId && replied.has(outreach.threadId)), now, settings.quietDays),
        sentAt: outreach?.sentAt ?? null,
      };
    })
    .sort((a, b) => order[a.stage] - order[b.stage]);
}

/** The posting's text: the application's own, else the crawled job it was applied to. */
async function postingText(application: { postingText: string; applyTask: { sharedPostingId: string } | null }): Promise<string> {
  if (application.postingText.trim()) return application.postingText;
  if (!application.applyTask) return "";
  // Shared postings belong to no student, so they're read outside the student's scope.
  const shared = await systemPrisma.sharedPosting.findUnique({ where: { id: application.applyTask.sharedPostingId }, select: { description: true } });
  return shared?.description ?? "";
}

async function application(applicationId: string) {
  const found = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, company: true, role: true, title: true, status: true, postingUrl: true, postingText: true, applyTask: { select: { sharedPostingId: true } }, outreach: true },
  });
  if (!found) throw new OutreachError("That application no longer exists.");
  return found;
}

export type OutreachView = {
  applicationId: string;
  company: string;
  role: string;
  postingUrl: string;
  /** Addresses the posting gives, to pick from. */
  suggestions: string[];
  contactName: string;
  contactEmail: string;
  subject: string;
  body: string;
  linkedinNote: string;
  followUpBody: string;
  stage: OutreachStage;
  sentAt: Date | null;
  followUpSentAt: Date | null;
  sentToday: number;
};

/** How many outreach emails the student sent in the last 24 hours. */
export async function sentInLastDay(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 86_400_000);
  const [first, followUps] = await Promise.all([
    prisma.outreach.count({ where: { sentAt: { gt: since } } }),
    prisma.outreach.count({ where: { followUpSentAt: { gt: since } } }),
  ]);
  return first + followUps;
}

/** One application's outreach, for its page. */
export async function loadOutreach(applicationId: string, now: Date = new Date()): Promise<OutreachView> {
  const [found, settings, sentToday] = await Promise.all([application(applicationId), loadSettings(), sentInLastDay(now)]);
  const outreach = found.outreach;
  const replied = outreach?.threadId ? (await repliedThreads([outreach.threadId])).size > 0 : false;
  return {
    applicationId: found.id,
    company: found.company,
    role: found.role || found.title,
    postingUrl: /^https?:\/\//i.test(found.postingUrl) ? found.postingUrl : "",
    suggestions: postingContacts(await postingText(found)),
    contactName: outreach?.contactName ?? "",
    contactEmail: outreach?.contactEmail ?? "",
    subject: outreach?.subject ?? "",
    body: outreach?.body ?? "",
    linkedinNote: outreach?.linkedinNote ?? "",
    followUpBody: outreach?.followUpBody ?? "",
    stage: outreachStage(outreach, replied, now, settings.quietDays),
    sentAt: outreach?.sentAt ?? null,
    followUpSentAt: outreach?.followUpSentAt ?? null,
    sentToday,
  };
}

export type OutreachFields = { contactName?: string; contactEmail?: string; subject?: string; body?: string; linkedinNote?: string; followUpBody?: string };

/** Keeps the student's edits; the first email can't change once it's sent. */
export async function saveOutreach(applicationId: string, fields: OutreachFields): Promise<void> {
  const found = await application(applicationId);
  if (fields.contactEmail?.trim() && emailAddresses(fields.contactEmail).length !== 1) throw new OutreachError("That isn't one email address.");
  const sent = Boolean(found.outreach?.sentAt);
  const data = {
    ...(sent
      ? {}
      : {
          ...(fields.contactName === undefined ? {} : { contactName: fields.contactName.trim().slice(0, 120) }),
          ...(fields.contactEmail === undefined ? {} : { contactEmail: fields.contactEmail.trim().toLowerCase().slice(0, 200) }),
          ...(fields.subject === undefined ? {} : { subject: fields.subject.replace(/\s+/g, " ").trim().slice(0, SUBJECT_MAX) }),
          ...(fields.body === undefined ? {} : { body: fields.body.slice(0, BODY_MAX) }),
        }),
    ...(fields.linkedinNote === undefined ? {} : { linkedinNote: fields.linkedinNote.slice(0, LINKEDIN_NOTE_MAX) }),
    ...(fields.followUpBody === undefined || found.outreach?.followUpSentAt ? {} : { followUpBody: fields.followUpBody.slice(0, BODY_MAX) }),
  };
  await prisma.outreach.upsert({ where: { applicationId }, create: { applicationId, ...data }, update: data });
}

/** Writes the first email (or, once that's sent, the follow-up) with AI, and keeps it as a draft. */
export async function draftOutreach(applicationId: string, signal?: AbortSignal): Promise<"first" | "follow-up"> {
  if (!(await isAiConfigured())) throw new OutreachError("Drafting needs an AI provider. Choose one in Settings → AI provider.");
  const found = await application(applicationId);
  if (found.outreach?.followUpSentAt) throw new OutreachError("The follow-up has gone out already.");
  const [provider, profile, options, description] = await Promise.all([getAiProvider(), loadProfile(), loadTaskOptions(), postingText(found)]);
  const input = {
    profile,
    job: { title: found.role || found.title, company: found.company, description },
    contactName: found.outreach?.contactName ?? "",
    previous: found.outreach?.body,
  };
  if (found.outreach?.sentAt) {
    const { data } = await writeFollowUp(provider, input, { ...options, signal });
    await prisma.outreach.update({ where: { applicationId }, data: { followUpBody: data } });
    return "follow-up";
  }
  const { data } = await writeOutreach(provider, input, { ...options, signal });
  await prisma.outreach.upsert({
    where: { applicationId },
    create: { applicationId, ...data },
    update: { subject: data.subject, body: data.body, linkedinNote: linkedinNote(data.linkedinNote) },
  });
  return "first";
}

/** Sends the first email, or its follow-up in the same thread, from the student's Gmail. */
export async function sendOutreach(applicationId: string, now: Date = new Date()): Promise<"first" | "follow-up"> {
  const account = await loadGoogleAccount();
  if (!account) throw new OutreachError("Connect your Google account in Settings → Google first.");
  const found = await application(applicationId);
  const outreach = found.outreach;
  if (!outreach) throw new OutreachError("Write the email first.");
  if (outreach.followUpSentAt) throw new OutreachError("The email and its follow-up have both gone out.");
  const followUp = Boolean(outreach.sentAt);
  const body = followUp ? outreach.followUpBody : outreach.body;
  const subject = followUp ? replySubject(outreach.subject) : outreach.subject;
  const problem = sendProblem({ contactEmail: outreach.contactEmail, subject, body });
  if (problem) throw new OutreachError(problem);
  if ((await sentInLastDay(now)) >= OUTREACH_PER_DAY) throw new OutreachError(`You've sent ${OUTREACH_PER_DAY} recruiter emails in the last day. Send the rest tomorrow.`);

  const name = (await loadProfileName()).trim();
  const from = name ? `${name.replace(/[<>"]/g, "")} <${account.email}>` : account.email;
  const to = recipientLine(outreach.contactName, outreach.contactEmail);
  const sent = await sendMail({ from, to, subject, body }, followUp && outreach.threadId ? { threadId: outreach.threadId } : {});
  await prisma.$transaction([
    prisma.outreach.update({
      where: { applicationId },
      data: followUp ? { followUpSentAt: now } : { sentAt: now, threadId: sent.threadId },
    }),
    // Kept with the application's mail, so Gmail sync links replies in this thread to it.
    prisma.emailMessage.upsert({
      where: { userId_gmailId: { userId: CURRENT_USER, gmailId: sent.id } },
      create: {
        gmailId: sent.id,
        threadId: sent.threadId,
        applicationId,
        direction: EmailDirection.OUTGOING,
        fromName: name,
        fromAddress: account.email.toLowerCase(),
        toAddress: to,
        subject,
        body,
        sentAt: now,
        handledAt: now,
      },
      update: {},
    }),
  ]);
  return followUp ? "follow-up" : "first";
}

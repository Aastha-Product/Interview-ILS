import { z } from "zod";

import { BODY_MAX, linkedinNote, SUBJECT_MAX } from "@/lib/outreach";
import { type ProfileData } from "@/lib/profile";

import { CREATIVITY, languageRule, NO_EM_DASHES, postingForPrompt, profileForPrompt, system, truthfulness, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

// Pathfinder (Phase 3): the email a student sends a recruiter or hiring manager after applying,
// and a short LinkedIn note saying the same, or a polite follow-up when there's been no answer.
// Nothing is sent from here: the student reads, edits and sends it from Outreach.

export const WRITE_OUTREACH_VERSION = "write-outreach@1";

export type OutreachDraft = { subject: string; body: string; linkedinNote: string };

const firstSchema = z.object({ subject: z.string(), body: z.string(), linkedinNote: z.string() });
const followUpSchema = z.object({ body: z.string() });

const FIRST = `You write a short email a job candidate sends to a recruiter or hiring manager after applying for a role, and a LinkedIn note saying the same, as JSON.

- subject: specific and short, with the role, e.g. "Applied for Data Analyst: SQL dashboards for 3 teams".
- body: a greeting (the contact by first name when given, else "Hi,"), then 70 to 120 words: that they applied for this role, the one or two things in their profile that fit this job best, with something concrete, and a low-pressure ask (a short call, or who to speak to). Then a sign-off and the candidate's name. Plain text, short paragraphs.
- linkedinNote: under 280 characters, one paragraph, the same point in fewer words, no greeting line or sign-off.
- Never claim anything the profile doesn't show, never flatter, no clichés ("passionate", "results-driven", "I hope this email finds you well").`;

const FOLLOW_UP = `You write a polite follow-up email a job candidate sends a recruiter who hasn't answered their first email, as JSON: { "body": "..." }.

- body: a greeting (the contact by first name when given, else "Hi,"), then 40 to 70 words: a reminder of the role they applied for, one new or sharper reason they fit, and an easy way to answer (even a no). Then a sign-off and the candidate's name.
- Don't repeat the first email, don't apologise for writing, never sound impatient, never claim anything the profile doesn't show.`;

export type OutreachInput = {
  profile: ProfileData;
  job: { title: string; company: string; description: string };
  contactName: string;
  /** The first email, when this is its follow-up. */
  previous?: string;
};

const contactLine = (name: string) => `The contact: ${name.trim() ? name.trim().slice(0, 100) : "not named"}.`;

/** A first email to a recruiter, with its subject and a LinkedIn note. */
export const writeOutreach: Task<OutreachInput, OutreachDraft> = async (provider, { profile, job, contactName }, options) => {
  const answer = await provider.complete({
    system: system(FIRST, NO_EM_DASHES, UNTRUSTED_POSTING, truthfulness(options.strict), CREATIVITY[options.creativity], languageRule(options.language)),
    messages: [
      {
        role: "user",
        content: [
          profileForPrompt(profile),
          `The job they applied for: ${job.title.trim() || "Untitled role"} at ${job.company.trim() || "the company"}.`,
          contactLine(contactName),
          postingForPrompt(job.description),
        ].join("\n\n"),
      },
    ],
    schema: firstSchema,
    schemaName: "recruiter_email",
    creativity: options.creativity,
    effort: "low",
    signal: options.signal,
  });
  return {
    data: { subject: oneLine(answer.subject).slice(0, SUBJECT_MAX), body: answer.body.trim().slice(0, BODY_MAX), linkedinNote: linkedinNote(answer.linkedinNote) },
    promptVersion: WRITE_OUTREACH_VERSION,
  };
};

/** A follow-up to a first email that had no answer. */
export const writeFollowUp: Task<OutreachInput, string> = async (provider, { profile, job, contactName, previous }, options) => {
  const answer = await provider.complete({
    system: system(FOLLOW_UP, NO_EM_DASHES, UNTRUSTED_POSTING, truthfulness(options.strict), CREATIVITY[options.creativity], languageRule(options.language)),
    messages: [
      {
        role: "user",
        content: [
          profileForPrompt(profile),
          `The job they applied for: ${job.title.trim() || "Untitled role"} at ${job.company.trim() || "the company"}.`,
          contactLine(contactName),
          `Their first email:\n<first_email>\n${(previous ?? "").trim().slice(0, BODY_MAX)}\n</first_email>`,
          postingForPrompt(job.description),
        ].join("\n\n"),
      },
    ],
    schema: followUpSchema,
    schemaName: "recruiter_follow_up",
    creativity: options.creativity,
    effort: "low",
    signal: options.signal,
  });
  return { data: answer.body.trim().slice(0, BODY_MAX), promptVersion: WRITE_OUTREACH_VERSION };
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

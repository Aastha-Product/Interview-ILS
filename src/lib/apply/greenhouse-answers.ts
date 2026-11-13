import "server-only";

import { experienceMonths } from "@/lib/match/preferences";
import { loadProfile } from "@/lib/profile-data";

import { answerForm, missingFields, type AnswerContext, type FormAnswers, type FormField } from "./answers";
import { greenhouseForm } from "./greenhouse-form";
import { loadAutoApply } from "./settings";

// Pathfinder (auto-apply): building a Greenhouse form's answers from the student's profile and saved
// answers. This lives on its own so it can be used both when a task is prepared (prepare.ts) and
// again when it's leased (lease.ts), so an answer the student edited after preparing is never
// submitted stale (QA M1). Lever and Ashby forms are read live by the extension, so they don't need it.

/** What the answers can draw on, from the profile and the saved answers; also for forms the extension reads. */
export async function answerContext(company: string, jobLocation = ""): Promise<AnswerContext> {
  const [profile, settings] = await Promise.all([loadProfile(), loadAutoApply()]);
  const years = profile.education.map((entry) => (entry.current ? null : entry.endYear)).filter((year): year is number => year !== null);
  // The current role, else the first in the profile's order (newest first).
  const role = profile.experience.find((entry) => entry.current) ?? profile.experience[0];
  return {
    basics: {
      name: profile.basics.name,
      email: profile.basics.email,
      phone: profile.basics.phone,
      city: profile.basics.city,
      country: profile.basics.country,
      linkedin: profile.basics.linkedin,
      website: profile.basics.website,
      address: profile.basics.address,
      dob: profile.basics.dob,
    },
    pastEmployers: profile.experience.map((entry) => entry.company).filter(Boolean),
    currentCompany: role?.company ?? "",
    currentTitle: role?.role ?? "",
    university: profile.education[0]?.school ?? "",
    experienceMonths: experienceMonths(profile.experience),
    experienceMonthsWithoutInternships: experienceMonths(profile.experience.filter((entry) => !/\bintern(ship)?\b|\btrainee\b/i.test(entry.role))),
    graduationYear: years.length > 0 ? String(Math.max(...years)) : "",
    company,
    jobLocation,
    cities: settings.preferences?.cities ?? [],
    saved: settings.answers,
  };
}

/** What a Greenhouse form needs: the answers it could fill, what it couldn't (required), and those as questions. */
export type GreenhouseAnswering = { answers: FormAnswers["answers"]; missing: string[]; questions: FormField[] };

/** Reads a Greenhouse job's form and answers it from the student's current profile and saved answers. */
export async function greenhouseAnswers(
  posting: { boardToken: string; externalId: string; companyName: string; location: string },
  signal: AbortSignal,
): Promise<GreenhouseAnswering> {
  const fields = await greenhouseForm(posting.boardToken, posting.externalId, signal);
  const form = answerForm(fields, await answerContext(posting.companyName, posting.location));
  return { answers: form.answers, missing: form.missing, questions: missingFields(fields, form.missing) };
}

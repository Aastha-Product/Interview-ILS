import "server-only";

import { z } from "zod";

import type { AutoApplySettings } from "@/generated/prisma/client";
import { MatchTier } from "@/generated/prisma/enums";
import { EMPLOYMENT_TYPES, LEVELS, type MatchPreferences } from "@/lib/match/preferences";
import { CURRENT_USER } from "@/lib/owner/scope";
import { prisma } from "@/lib/prisma";

import { savedAnswersSchema, type SavedAnswers } from "./answers";

// Pathfinder (auto-apply step 4): what a student allowed auto-apply to do. Nothing is submitted
// until they've agreed to the consent below and switched it on; it starts as a dry run that fills
// forms but stops before Submit, until they switch that off too.

/** Bump when the wording changes: students are asked again. Review with a lawyer before launch. */
export const CONSENT_VERSION = "2026-11-10";
export const CONSENT_TEXT =
  "I allow Pathfinder to submit job applications for me, from my own browser, to jobs that match my profile, " +
  "within the limits I set here. Pathfinder will use only information from my profile and the answers I give on this page, " +
  "and will never make up experience or qualifications. I can pause or switch this off at any time, and I'm responsible " +
  "for keeping my profile and answers accurate.";

export const preferencesSchema = z.object({
  titles: z.array(z.string().trim().min(1).max(200)).min(1, "Add at least one role you're looking for.").max(10),
  skills: z.array(z.string().trim().min(1).max(100)).max(60),
  countries: z.array(z.string().regex(/^[a-z]{2}$/)).min(1).max(10),
  cities: z.array(z.string().trim().min(1).max(100)).max(10),
  remoteOk: z.boolean(),
  level: z.enum(LEVELS),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(4),
}) satisfies z.ZodType<MatchPreferences>;

export const settingsInputSchema = z.object({
  preferences: preferencesSchema,
  minTier: z.enum([MatchTier.STRONG, MatchTier.GOOD]),
  dailyLimit: z.number().int().min(1).max(50),
  perCompanyLimit: z.number().int().min(1).max(5),
  dryRun: z.boolean(),
  answers: savedAnswersSchema,
});
export type AutoApplyInput = z.input<typeof settingsInputSchema>;

export type AutoApplyView = {
  enabled: boolean;
  consented: boolean;
  /** The consent given was for an older wording: asked again. */
  consentOutdated: boolean;
  preferences: MatchPreferences | null;
  minTier: "STRONG" | "GOOD";
  dailyLimit: number;
  perCompanyLimit: number;
  dryRun: boolean;
  answers: SavedAnswers;
};

const DEFAULTS = { minTier: MatchTier.GOOD, dailyLimit: 10, perCompanyLimit: 2, dryRun: true } as const;

function view(row: AutoApplySettings | null): AutoApplyView {
  const preferences = row?.preferences ? preferencesSchema.safeParse(row.preferences) : null;
  const consented = Boolean(row?.consentAt) && row?.consentVersion === CONSENT_VERSION;
  return {
    enabled: Boolean(row?.enabled) && consented,
    consented,
    consentOutdated: Boolean(row?.consentAt) && row?.consentVersion !== CONSENT_VERSION,
    preferences: preferences?.success ? preferences.data : null,
    minTier: row?.minTier === MatchTier.STRONG ? MatchTier.STRONG : MatchTier.GOOD,
    dailyLimit: row?.dailyLimit ?? DEFAULTS.dailyLimit,
    perCompanyLimit: row?.perCompanyLimit ?? DEFAULTS.perCompanyLimit,
    dryRun: row?.dryRun ?? DEFAULTS.dryRun,
    answers: savedAnswersSchema.parse(row?.answers ?? {}),
  };
}

const own = { userId: CURRENT_USER };

/** The current student's auto-apply settings, with defaults for what they haven't set. */
export async function loadAutoApply(): Promise<AutoApplyView> {
  return view(await prisma.autoApplySettings.findUnique({ where: own }));
}

/** Saves what "Set up job search" asks; doesn't switch auto-apply on or off. */
export async function saveAutoApply(input: AutoApplyInput): Promise<AutoApplyView> {
  const data = settingsInputSchema.parse(input);
  const row = await prisma.autoApplySettings.upsert({
    where: own,
    create: { ...data, preferences: data.preferences, answers: data.answers },
    update: { ...data, preferences: data.preferences, answers: data.answers },
  });
  return view(row);
}

/** Records the student's agreement to the current consent wording. */
export async function giveConsent(): Promise<AutoApplyView> {
  const consent = { consentAt: new Date(), consentVersion: CONSENT_VERSION };
  return view(await prisma.autoApplySettings.upsert({ where: own, create: consent, update: consent }));
}

export class AutoApplyNotReady extends Error {
  override name = "AutoApplyNotReady";
}

/** Switches auto-apply on (after consent and preferences) or off. Off always works. */
export async function setAutoApplyEnabled(enabled: boolean): Promise<AutoApplyView> {
  if (enabled) {
    const current = await loadAutoApply();
    if (!current.consented) throw new AutoApplyNotReady("Read and agree to how auto-apply works first.");
    if (!current.preferences) throw new AutoApplyNotReady("Set up your job search first: the roles and places you're looking for.");
  }
  return view(await prisma.autoApplySettings.upsert({ where: own, create: { enabled }, update: { enabled } }));
}

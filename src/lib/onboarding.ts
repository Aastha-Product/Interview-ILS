// Pathfinder (Phase 1): the onboarding guide. A new student is walked through the few things the
// service needs, in order, on the dashboard. Each step is done when the app sees it done (nothing
// is ticked by hand), so the guide picks up wherever they left off and goes once all are done.

/** What the app knows about the student's setup. */
export type OnboardingFacts = {
  /** The profile has work, studies or skills: what every resume is built from. */
  profileReady: boolean;
  /** They've said what to look for: a search with keywords and a country, or job titles. */
  searchReady: boolean;
  /** Set up job search has every answer it stars, the questions most forms ask. */
  answersReady: boolean;
  agentOn: boolean;
  /** A browser's Pathfinder extension is connected. */
  browserConnected: boolean;
};

export type OnboardingStepId = "profile" | "search" | "answers" | "agent" | "extension";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  href: string;
  done: boolean;
};

const STEPS: readonly (Omit<OnboardingStep, "done"> & { fact: keyof OnboardingFacts })[] = [
  {
    id: "profile",
    fact: "profileReady",
    title: "Add your resume",
    description: "Upload it and we fill in your profile: your roles, studies and skills. Every tailored resume is built from it.",
    href: "/profile/import",
  },
  {
    id: "search",
    fact: "searchReady",
    title: "Say what you're looking for",
    description: "The roles and the country you want, so the job agent knows what to search.",
    href: "/settings?section=agent",
  },
  {
    id: "answers",
    fact: "answersReady",
    title: "Answer the questions most forms ask",
    description: "Notice period, work authorisation, expected salary and a few more, once, so applications don't stop to ask.",
    href: "/auto-apply/setup",
  },
  {
    id: "agent",
    fact: "agentOn",
    title: "Turn on the job agent",
    description: "Once a day it searches, scores new postings against your profile and keeps only the ones worth applying to.",
    href: "/settings?section=agent",
  },
  {
    id: "extension",
    fact: "browserConnected",
    title: "Connect the Chrome extension",
    description: "Applications are submitted from your own browser by the Pathfinder extension, never from our servers.",
    href: "/auto-apply/extension",
  },
];

/** The steps in order, each marked done or not. */
export function onboardingSteps(facts: OnboardingFacts): OnboardingStep[] {
  return STEPS.map(({ fact, ...step }) => ({ ...step, done: facts[fact] }));
}

/** The first step not done yet; null once every one is. */
export function nextOnboardingStep(steps: readonly OnboardingStep[]): OnboardingStep | null {
  return steps.find((step) => !step.done) ?? null;
}

/** Whether the guide shows: until every step is done, unless the student hid it. */
export function showOnboarding(steps: readonly OnboardingStep[], hidden: boolean): boolean {
  return !hidden && nextOnboardingStep(steps) !== null;
}

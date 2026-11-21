import { describe, expect, it } from "vitest";

import { nextOnboardingStep, onboardingSteps, showOnboarding, type OnboardingFacts } from "./onboarding";

const nothing: OnboardingFacts = { profileReady: false, searchReady: false, answersReady: false, agentOn: false, browserConnected: false };
const everything: OnboardingFacts = { profileReady: true, searchReady: true, answersReady: true, agentOn: true, browserConnected: true };

describe("the onboarding guide (Phase 1)", () => {
  it("walks a new student through the steps in order, starting with the resume", () => {
    const steps = onboardingSteps(nothing);
    expect(steps.map((step) => step.id)).toEqual(["profile", "search", "answers", "agent", "extension"]);
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(nextOnboardingStep(steps)).toMatchObject({ id: "profile", href: "/profile/import" });
  });

  it("ticks what the app sees done, and goes on to the first step that isn't, whatever the order", () => {
    const steps = onboardingSteps({ ...nothing, profileReady: true, agentOn: true });
    expect(steps.filter((step) => step.done).map((step) => step.id)).toEqual(["profile", "agent"]);
    expect(nextOnboardingStep(steps)?.id).toBe("search");
  });

  it("asks to connect Gmail after the resume, only once the server has Google set up (Phase 1)", () => {
    expect(onboardingSteps({ ...nothing, gmailConnected: null }).map((step) => step.id)).not.toContain("gmail");
    const steps = onboardingSteps({ ...nothing, profileReady: true, gmailConnected: false });
    expect(steps.map((step) => step.id)).toEqual(["profile", "gmail", "search", "answers", "agent", "extension"]);
    expect(nextOnboardingStep(steps)).toMatchObject({ id: "gmail", href: "/settings?section=google" });
    expect(nextOnboardingStep(onboardingSteps({ ...nothing, profileReady: true, gmailConnected: true }))?.id).toBe("search");
  });

  it("shows until every step is done, unless the student hid it", () => {
    expect(showOnboarding(onboardingSteps(nothing), false)).toBe(true);
    expect(showOnboarding(onboardingSteps(nothing), true)).toBe(false);
    expect(showOnboarding(onboardingSteps(everything), false)).toBe(false);
    expect(nextOnboardingStep(onboardingSteps(everything))).toBeNull();
  });
});

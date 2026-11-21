import "server-only";

import { agentQueryReady } from "@/lib/agent/run";
import { loadAutoApply } from "@/lib/apply/settings";
import { listExtensionTokens } from "@/lib/extension/tokens";
import { googleConnection } from "@/lib/google/account";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

import { onboardingSteps, showOnboarding, type OnboardingStep } from "./onboarding";

export type OnboardingView = { steps: OnboardingStep[]; show: boolean };

/** The onboarding guide for the dashboard, from what the student has set up so far. */
export async function loadOnboarding(now = new Date()): Promise<OnboardingView> {
  const [profile, settings, autoApply, tokens, google] = await Promise.all([loadProfile(), loadSettings(), loadAutoApply(), listExtensionTokens(now), googleConnection()]);
  const steps = onboardingSteps({
    profileReady: profile.experience.length + profile.education.length + profile.skills.length + profile.projects.length > 0,
    searchReady: agentQueryReady(settings.agentQuery) || (autoApply.preferences?.titles.length ?? 0) > 0,
    answersReady: autoApply.preferences !== null && autoApply.missing.length === 0,
    agentOn: settings.agentEnabled,
    browserConnected: tokens.length > 0,
    // Only once the server has a Google client: before that, there is nothing to connect to.
    gmailConnected: google.status === "not-configured" ? null : google.status === "connected",
  });
  return { steps, show: showOnboarding(steps, settings.onboardingHidden) };
}

import type { SettingsData } from "@/lib/settings";

// Pathfinder runs as a managed service (PATHFINDER_MANAGED, on unless set to off): the AI, the
// job search, scoring and the Google client are the server's, set with the DOSSIER_* variables.
// Students never choose a provider or enter a key, and whatever a student saved before (or put
// in an imported file) is ignored. Read process.env directly, not env, so modules that only need
// this switch don't require the whole environment to be valid (tests, the settings parser).

/** Whether this server is the managed Pathfinder service rather than a self-hosted Dossier. */
export function managedMode(): boolean {
  return (process.env.PATHFINDER_MANAGED ?? "on").trim().toLowerCase() !== "off";
}

/** The settings with every student's own provider, key and client removed, in managed mode. */
export function withoutStudentConfig<T extends Partial<SettingsData>>(settings: T): T {
  if (!managedMode()) return settings;
  return {
    ...settings,
    provider: null,
    baseUrl: null,
    model: null,
    apiKeyEnc: null,
    jobSource: null,
    jsearchKeyEnc: null,
    adzunaAppId: null,
    adzunaKeyEnc: null,
    scorer: null,
    typesafeKeyEnc: null,
    googleClientId: null,
    googleClientSecretEnc: null,
  };
}

/** What a student reads when a managed feature isn't working, instead of "check your key". */
export const MANAGED_UNAVAILABLE = {
  ai: "The AI is busy or unavailable right now. Please try again in a few minutes.",
  jobs: "Job search isn't available right now. Please try again in a few minutes.",
  scoring: "Scoring isn't available right now. Please try again in a few minutes.",
  google: "Connecting Google isn't available on Pathfinder yet.",
} as const;

/**
 * In managed mode, a message that sends the student to a technical settings section (to choose
 * an AI provider, enter a key or set up an OAuth client) is replaced with a plain one: the
 * student can't change those, the service runs them. Other messages pass through unchanged.
 */
export function studentMessage(message: string): string {
  if (!managedMode()) return message;
  if (/Settings → AI provider|AI provider in Settings/i.test(message)) return MANAGED_UNAVAILABLE.ai;
  if (/Settings → Job search/i.test(message)) return MANAGED_UNAVAILABLE.jobs;
  if (/Settings → Scoring/i.test(message)) return MANAGED_UNAVAILABLE.scoring;
  if (/Settings → Google/i.test(message)) return MANAGED_UNAVAILABLE.google;
  return message;
}

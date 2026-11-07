/** The settings sections, in order (PRD §6.8), where the job-search tools are on. */
export const SETTINGS_SECTIONS = [
  { id: "ai", label: "AI provider" },
  { id: "jobs", label: "Job search" },
  { id: "scoring", label: "Scoring" },
  { id: "agent", label: "Job agent" },
  { id: "documents", label: "Documents" },
  { id: "google", label: "Google" },
  // Pathfinder: the MCP connector (#221) isn't available on a server with many students yet: its
  // tokens don't name a student. Its section comes back once they do.
  { id: "data", label: "Your data" },
  { id: "about", label: "About" },
] as const;

/**
 * Pathfinder: what students see where the tools are off (PATHFINDER_TOOLS). Nothing technical:
 * the server runs the AI, so there's no provider, model or key to choose.
 */
export const STUDENT_SETTINGS_SECTIONS = [
  { id: "account", label: "Account" },
  { id: "plan", label: "Plan" },
  { id: "privacy", label: "Privacy and data" },
  { id: "help", label: "Help" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"] | (typeof STUDENT_SETTINGS_SECTIONS)[number]["id"];
export type SettingsSections = readonly { id: SettingsSectionId; label: string }[];

/** The section in `?section=`, or the first one when it's missing or unknown. */
export function settingsSectionFromParam(value: string | string[] | undefined, sections: SettingsSections = SETTINGS_SECTIONS): SettingsSectionId {
  return sections.find((section) => section.id === value)?.id ?? sections[0].id;
}

export const settingsSectionHref = (id: SettingsSectionId) => `/settings?section=${id}`;

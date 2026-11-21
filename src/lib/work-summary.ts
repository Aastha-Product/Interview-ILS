import type { ProfileData } from "@/lib/profile";

// Pathfinder (Phase 1): the auto-generated work summary. "Write with AI" on Profile → Basics drafts
// the few lines about the student from their profile (improve-summary); the draft is shown beside
// the field and replaces it only when the student chooses "Use this".

/** Whether the profile has anything to summarise: work, projects, studies or skills. */
export function hasWorkToSummarize(profile: Pick<ProfileData, "experience" | "projects" | "education" | "skills">): boolean {
  return profile.experience.length + profile.projects.length + profile.education.length + profile.skills.length > 0;
}

/** The most a student may say to steer a draft, e.g. "shorter" or "lead with my internship". */
export const SUMMARY_INSTRUCTION_MAX = 300;

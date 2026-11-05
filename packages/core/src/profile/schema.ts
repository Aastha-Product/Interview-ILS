import { z } from "zod";

// Shared by the API, the resume importer and the browser editor. Keep it free of server imports.

// Control characters (NUL and friends; tab and newlines are kept) can come in with text extracted
// from a PDF. Postgres can't store NUL, so they are dropped before any other check. (overwrite keeps
// the schema a plain string, so callers can still chain .min/.max.)
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const text = (max: number) =>
  z
    .string()
    .overwrite((v) => v.replace(CONTROL_CHARS, ""))
    .trim()
    .max(max, `Keep this under ${max} characters`);
const required = (max: number, label: string) => text(max).min(1, `${label} is required`);

export const LIMITS = {
  links: 10,
  experiences: 20,
  projects: 20,
  education: 10,
  skills: 60,
  highlights: 10,
  technologies: 20,
} as const;

const httpUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => {
    try {
      const url = new URL(v);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a full web address starting with https://");

export const linkSchema = z.object({ label: required(40, "Label"), url: httpUrl });

const highlights = z.array(text(300)).max(LIMITS.highlights, `Up to ${LIMITS.highlights} points`);

export const experienceSchema = z.object({
  title: required(150, "Job title"),
  company: text(150).default(""),
  location: text(120).default(""),
  startDate: text(30).default(""),
  endDate: text(30).default(""),
  current: z.boolean().default(false),
  highlights: highlights.default([]),
});

export const projectSchema = z.object({
  name: required(150, "Project name"),
  role: text(100).default(""),
  url: z.union([z.literal(""), httpUrl]).default(""),
  startDate: text(30).default(""),
  endDate: text(30).default(""),
  technologies: z.array(text(50)).max(LIMITS.technologies).default([]),
  highlights: highlights.default([]),
});

export const educationSchema = z.object({
  institution: required(200, "College or school"),
  degree: text(120).default(""),
  field: text(120).default(""),
  startDate: text(30).default(""),
  endDate: text(30).default(""),
  grade: text(50).default(""),
});

export const skillSchema = z.object({
  name: required(60, "Skill"),
  category: text(60).default(""),
});

export const profileInputSchema = z.object({
  headline: text(150).default(""),
  summary: text(2000).default(""),
  location: text(120).default(""),
  phone: text(30).default(""),
  links: z.array(linkSchema).max(LIMITS.links).default([]),
  experiences: z.array(experienceSchema).max(LIMITS.experiences).default([]),
  projects: z.array(projectSchema).max(LIMITS.projects).default([]),
  education: z.array(educationSchema).max(LIMITS.education).default([]),
  skills: z.array(skillSchema).max(LIMITS.skills).default([]),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type ExperienceInput = z.infer<typeof experienceSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type EducationInput = z.infer<typeof educationSchema>;
export type SkillInput = z.infer<typeof skillSchema>;
export type LinkInput = z.infer<typeof linkSchema>;

/** A saved profile as the API returns it. `version` is 0 before the first save. */
export type ProfileView = ProfileInput & { version: number; updatedAt: string | null };

export const saveProfileRequestSchema = z.object({
  /** The version the editor started from; a mismatch means another tab saved first. */
  expectedVersion: z.number().int().min(0),
  profile: profileInputSchema,
});

export function emptyProfile(): ProfileInput {
  return profileInputSchema.parse({});
}

export const EXPERIENCE_LEVELS = ["FRESHER", "ZERO_TO_ONE", "ONE_TO_THREE"] as const;

export const preferencesSchema = z.object({
  roles: z.array(text(80).min(1)).min(1, "Add at least one role").max(10),
  locations: z.array(text(80).min(1)).max(10).default([]),
  remoteOk: z.boolean().default(true),
  minSalary: z.number().int().min(0).max(100_000_000).nullable().default(null),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).default("FRESHER"),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;

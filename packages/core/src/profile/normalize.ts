import type { ResumeDraft } from "@pathfinder/ai";
import { LIMITS, profileInputSchema, type ProfileInput } from "./schema";

const cut = (value: string | undefined, max: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function toUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
}

const list = (items: string[], maxItems: number, maxLen: number) =>
  items.map((s) => cut(s, maxLen)).filter(Boolean).slice(0, maxItems);

/**
 * Turns whatever the model (or the mock) returned into a valid ProfileInput: trims, truncates,
 * drops items missing their required field, fixes link addresses and de-duplicates skills.
 * The student reviews the result before anything is saved.
 */
export function draftToProfileInput(draft: ResumeDraft): ProfileInput {
  const seenSkills = new Set<string>();
  const candidate = {
    headline: cut(draft.headline, 150),
    summary: cut(draft.summary, 2000),
    location: cut(draft.location, 120),
    phone: cut(draft.phone, 30),
    links: draft.links
      .map((l) => ({ label: cut(l.label, 40) || "Link", url: toUrl(l.url) }))
      .filter((l): l is { label: string; url: string } => l.url !== null)
      .slice(0, LIMITS.links),
    experiences: draft.experiences
      .map((e) => ({
        title: cut(e.title, 150),
        company: cut(e.company, 150),
        location: cut(e.location, 120),
        startDate: cut(e.startDate, 30),
        endDate: cut(e.endDate, 30),
        current: Boolean(e.current),
        highlights: list(e.highlights, LIMITS.highlights, 300),
      }))
      .filter((e) => e.title)
      .slice(0, LIMITS.experiences),
    projects: draft.projects
      .map((p) => ({
        name: cut(p.name, 150),
        role: cut(p.role, 100),
        url: toUrl(p.url) ?? "",
        startDate: cut(p.startDate, 30),
        endDate: cut(p.endDate, 30),
        technologies: list(p.technologies, LIMITS.technologies, 50),
        highlights: list(p.highlights, LIMITS.highlights, 300),
      }))
      .filter((p) => p.name)
      .slice(0, LIMITS.projects),
    education: draft.education
      .map((e) => ({
        institution: cut(e.institution, 200),
        degree: cut(e.degree, 120),
        field: cut(e.field, 120),
        startDate: cut(e.startDate, 30),
        endDate: cut(e.endDate, 30),
        grade: cut(e.grade, 50),
      }))
      .filter((e) => e.institution)
      .slice(0, LIMITS.education),
    skills: draft.skills
      .map((s) => ({ name: cut(s.name, 60), category: cut(s.category, 60) }))
      .filter((s) => {
        const key = s.name.toLowerCase();
        if (!key || seenSkills.has(key)) return false;
        seenSkills.add(key);
        return true;
      })
      .slice(0, LIMITS.skills),
  };
  return profileInputSchema.parse(candidate);
}

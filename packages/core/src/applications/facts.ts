import type { ProfileInput } from "../profile/schema";
import type { ProfileFact } from "./types";

export const dateRange = (start: string, end: string, current = false): string =>
  [start.trim(), end.trim() || (current ? "Present" : "")].filter(Boolean).join(" – ");

/**
 * Every claim the drafting model may use, each with a stable id it must cite (see types.ts).
 * Indices are positions in the saved profile, so ids stay the same when empty highlights are skipped.
 */
export function buildProfileFacts(p: ProfileInput): ProfileFact[] {
  const facts: ProfileFact[] = [];
  const add = (fact: ProfileFact) => {
    if (fact.text.trim()) facts.push({ ...fact, text: fact.text.trim() });
  };

  add({ id: "headline", kind: "headline", text: p.headline });
  add({ id: "summary", kind: "summary", text: p.summary });
  p.skills.forEach((s, i) => add({ id: `skill:${i}`, kind: "skill", text: s.name }));

  p.experiences.forEach((e, i) => {
    const id = `exp:${i}`;
    const dates = dateRange(e.startDate, e.endDate, e.current);
    add({
      id,
      kind: "experience",
      text: `${e.title}${e.company ? ` at ${e.company}` : ""}${e.location ? `, ${e.location}` : ""}${dates ? ` (${dates})` : ""}`,
    });
    e.highlights.forEach((h, j) => add({ id: `${id}:h${j}`, kind: "experience_highlight", text: h, parentId: id }));
  });

  p.projects.forEach((pr, i) => {
    const id = `proj:${i}`;
    add({
      id,
      kind: "project",
      text: `${pr.name}${pr.role ? ` (${pr.role})` : ""}${pr.technologies.length ? ` — ${pr.technologies.join(", ")}` : ""}`,
    });
    pr.highlights.forEach((h, j) => add({ id: `${id}:h${j}`, kind: "project_highlight", text: h, parentId: id }));
  });

  p.education.forEach((ed, i) => {
    const dates = dateRange(ed.startDate, ed.endDate);
    const degree = [ed.degree, ed.field].filter(Boolean).join(" in ");
    add({
      id: `edu:${i}`,
      kind: "education",
      text: [degree, ed.institution].filter(Boolean).join(", ") + (dates ? ` (${dates})` : "") + (ed.grade ? `, ${ed.grade}` : ""),
    });
  });

  p.links.forEach((l, i) => add({ id: `link:${i}`, kind: "link", text: `${l.label}: ${l.url}` }));
  return facts;
}

import type { ProfileInput } from "./schema";

export interface ProfileStrength {
  /** 0 to 100. */
  score: number;
  label: "Just started" | "Getting there" | "Strong";
  /** Plain-English next steps, most useful first. */
  tips: string[];
}

/**
 * A simple, explainable profile score for freshers. Projects weigh as much as experience,
 * because most students do not have job titles yet.
 */
export function profileStrength(p: ProfileInput): ProfileStrength {
  let score = 0;
  const tips: string[] = [];

  if (p.headline) score += 10;
  else tips.push("Add a headline, for example “Final-year B.Tech student looking for QA roles”.");

  if (p.summary.length >= 80) score += 10;
  else tips.push("Write a two or three line summary of what you are looking for.");

  if (p.location) score += 5;
  else tips.push("Add your city so we can match jobs near you.");

  if (p.education.length > 0) score += 15;
  else tips.push("Add your college and degree.");

  const skillPoints = Math.min(p.skills.length, 8) * 2.5;
  score += skillPoints;
  if (p.skills.length < 8) tips.push(`Add ${8 - p.skills.length} more skill${p.skills.length === 7 ? "" : "s"} (tools, languages, frameworks).`);

  const strongProjects = p.projects.filter((x) => x.highlights.filter(Boolean).length >= 2).length;
  const strongExperience = p.experiences.filter((x) => x.highlights.filter(Boolean).length >= 1).length;
  const work = Math.min(strongProjects + strongExperience, 3);
  score += Math.round((work / 3) * 30);
  if (work < 3) {
    tips.push(
      p.projects.length === 0 && p.experiences.length === 0
        ? "Add a project or internship. College projects count."
        : "Add at least two points to each project saying what you built and the result.",
    );
  }

  if (p.links.length > 0) score += 10;
  else tips.push("Add a LinkedIn or GitHub link.");

  score = Math.min(100, Math.round(score));
  const label = score >= 75 ? "Strong" : score >= 40 ? "Getting there" : "Just started";
  return { score, label, tips: tips.slice(0, 3) };
}

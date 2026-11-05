import type { Status } from "./applications";

/** Shapes the jobs API sends to the browser. */

export interface JobSummary {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  source: "jsearch" | "adzuna" | "manual";
  applyUrl: string | null;
  postedAt: string | null;
}

export interface MatchGap {
  kind: "skill" | "experience" | "location" | "other";
  text: string;
}

export interface MatchSummary {
  score: number;
  reasons: string[];
  gaps: MatchGap[];
  explanation: string;
}

/** The student's application for a job, if they already started one. */
export interface ExistingApplication {
  id: string;
  status: Status;
}

export interface JobCardData {
  job: JobSummary;
  match: MatchSummary | null;
  application: ExistingApplication | null;
}

export interface SearchResponse {
  results: JobCardData[];
  fromCache: boolean;
  notices: string[];
}

export function scoreLabel(score: number): { label: string; className: string } {
  if (score >= 70) return { label: "Good match", className: "bg-green-100 text-green-800 border-green-200" };
  if (score >= 45) return { label: "Partial match", className: "bg-amber-100 text-amber-900 border-amber-200" };
  return { label: "Weak match", className: "bg-slate-100 text-slate-700 border-slate-200" };
}

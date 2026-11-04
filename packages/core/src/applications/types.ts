/**
 * Shapes shared by drafting (ai.tailor), PDF rendering (pdf.render), the API and the review UI.
 * Stored in GeneratedDocument.content (RESUME → ResumeContent, ANSWERS → AnswersContent) and
 * GeneratedDocument.factCheck (FactCheckReport). Client-safe: no server imports.
 */

/**
 * One fact from the student's profile, with a stable id the model must cite.
 * Ids: "headline", "summary", "skill:<i>", "exp:<i>", "exp:<i>:h<j>", "proj:<i>", "proj:<i>:h<j>",
 * "edu:<i>", "link:<i>" (i and j are 0-based positions in the saved profile).
 */
export interface ProfileFact {
  id: string;
  kind: "headline" | "summary" | "skill" | "experience" | "experience_highlight" | "project" | "project_highlight" | "education" | "link";
  text: string;
  /** For highlights: the experience or project they belong to ("exp:0", "proj:1"). */
  parentId?: string;
}

export interface ResumeBullet {
  id: string;
  text: string;
  /** Profile facts this bullet is based on. Empty only when the student wrote the bullet themselves. */
  factIds: string[];
  editedByStudent?: boolean;
}

export interface ResumeContent {
  /** Taken from the account and profile, never from the model. */
  header: {
    name: string;
    email: string;
    phone: string;
    location: string;
    links: Array<{ label: string; url: string }>;
  };
  headline: string;
  summary: { text: string; factIds: string[]; editedByStudent?: boolean };
  /** A subset of the profile's skills, ordered by relevance to the job. */
  skills: string[];
  /** Titles, companies and dates are copied from the profile by sourceId; only bullets are written. */
  experiences: Array<{
    sourceId: string;
    title: string;
    company: string;
    location: string;
    dates: string;
    bullets: ResumeBullet[];
  }>;
  projects: Array<{
    sourceId: string;
    name: string;
    role: string;
    technologies: string[];
    url: string;
    dates: string;
    bullets: ResumeBullet[];
  }>;
  education: Array<{
    sourceId: string;
    institution: string;
    degree: string;
    field: string;
    dates: string;
    grade: string;
  }>;
}

export interface AnswerItem {
  id: string;
  question: string;
  answer: string;
  factIds: string[];
  /** True when the profile lacks what the question needs (e.g. notice period): the student must fill it in. */
  needsInput: boolean;
  /** Plain-English note for the student, e.g. "Add when you can join". */
  note: string;
  editedByStudent?: boolean;
}

export interface AnswersContent {
  answers: AnswerItem[];
}

export interface FactCheckReport {
  checkedAt: string;
  /** True if the first draft failed the check and was regenerated once. */
  regenerated: boolean;
  /** Bullets or answers removed because the profile doesn't support them. */
  removed: Array<{ text: string; reason: string }>;
  /** Things the job asks for that the profile doesn't show (shown as gaps, never invented). */
  gaps: string[];
  /** Number of bullets and answers that passed. */
  passed: number;
}

/** What the student sees for a background task. */
export type TaskStateView = "queued" | "working" | "needs_input" | "done" | "failed";

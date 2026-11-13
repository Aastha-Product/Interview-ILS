// Pathfinder extension (auto-apply step 5b): the messages between its parts, and the shapes of the
// server's answers (src/app/api/ext/). Kept free of DOM and chrome.* so tests can import it.

/** The messages Pathfinder's page (src/app/(app)/auto-apply/extension/extension-screen.tsx) and the bridge exchange. */
export const BRIDGE = {
  ping: "pathfinder-is-extension-there",
  hello: "pathfinder-extension-here",
  connect: "pathfinder-connect-extension",
  connected: "pathfinder-extension-connected",
} as const;

/** Set only in the Chrome tests' build (build.mjs --test): their fake Pathfinder. */
declare const __PATHFINDER_TEST_ORIGIN__: string | undefined;
const TEST_ORIGIN = typeof __PATHFINDER_TEST_ORIGIN__ === "string" ? [__PATHFINDER_TEST_ORIGIN__] : [];

/** True only in the Web Store's build (build.mjs --store): no local development address. */
declare const __PATHFINDER_STORE__: boolean | undefined;
const DEV_ORIGIN = typeof __PATHFINDER_STORE__ === "boolean" && __PATHFINDER_STORE__ ? [] : ["http://localhost:3000"];

/** Pathfinder's own sites, where the bridge runs and where the token may be sent. */
export const PATHFINDER_ORIGINS: readonly string[] = ["https://pathfinderedtech.com", "https://www.pathfinderedtech.com", ...DEV_ORIGIN, ...TEST_ORIGIN];

export const isPathfinderOrigin = (origin: string): boolean => PATHFINDER_ORIGINS.includes(origin);

export type FieldType = "text" | "textarea" | "file" | "single" | "multi" | "hidden";
export type FieldOption = { label: string; value: string };
/** A question as the server's answer rules read it (src/lib/apply/answers.ts). */
export type FormField = { key: string; label: string; required: boolean; type: FieldType; options: FieldOption[] };

export type Answer =
  | { kind: "text"; value: string }
  | { kind: "option"; value: string; label: string }
  | { kind: "options"; values: string[]; labels: string[] }
  | { kind: "file"; file: "resume" | "cover_letter" };

/** POST /api/ext/lease (src/lib/apply/lease.ts LeasedTask). */
export type LeasedTask = {
  taskId: string;
  leaseId: string;
  leaseUntil: string;
  applyUrl: string;
  system: "GREENHOUSE" | "LEVER" | "ASHBY" | "SMARTRECRUITERS" | string;
  title: string;
  company: string;
  dryRun: boolean;
  answers: Record<string, Answer> | null;
  documents: { resume: boolean; coverLetter: boolean };
};

export type Report =
  | { outcome: "submitting" }
  | { outcome: "applied"; evidence: { url: string; text: string } }
  | { outcome: "dry-run" }
  | { outcome: "needs-student"; reason: string }
  | { outcome: "uncertain"; reason?: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "release" };

export type FormAnswers = { answers: Record<string, Answer>; missing: string[] };

/** A PDF handed from the background to the page, as base64 (messages carry JSON only). */
export type DocumentFile = { name: string; type: string; base64: string };

/** From the apply script (in the job's tab) to the background, which calls Pathfinder for it. */
export type TabRequest =
  | { type: "task" }
  | { type: "answers"; fields: FormField[] }
  | { type: "document"; kind: "resume" | "letter" }
  /** keepTab: leave the job's tab open for the student (filled in, or to check). */
  | { type: "report"; report: Report; keepTab?: boolean };

/** From the bridge (on Pathfinder's page) to the background. */
export type BridgeRequest = { type: "connect"; token: string };

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** Reasons the student reads on the dashboard, beside "Needs you". */
export const REASONS = {
  challenge: "The job site asked for a check only you can do. The form is filled in and open in Chrome: finish the check and submit it there, then mark it as applied.",
  emailCode: "The job site sent a code to your email. The form is open in Chrome: enter the code there, then mark it as applied.",
  noForm: "This company uses its own application page, which Pathfinder can't fill yet. Apply from the job's page.",
  noSubmit: "The form is filled in and open in Chrome, but Pathfinder couldn't find its Submit button. Submit it there, then mark it as applied.",
  login: "The job site asked you to sign in. Sign in and apply from the job's page.",
  unanswered: (labels: string[]) => `Answer ${labels.length === 1 ? "this question" : "these questions"} to apply: ${labels.slice(0, 5).join("; ")}${labels.length > 5 ? "; …" : ""}. The form is filled in up to there and open in Chrome.`,
  formError: (text: string) => `The job site didn't accept the form${text ? `: "${text.slice(0, 200)}"` : ""}. It's open in Chrome to fix and submit.`,
  noAnswer: "Submit was pressed but the job site didn't confirm. Check your email or the job site before applying again.",
  pageFailed: "The job's page didn't load.",
} as const;

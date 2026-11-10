// Pathfinder extension: one application, in the job's tab. The order matters:
// 1. find the form (else hand it to the student);
// 2. fill the server's answers, then ask the server about any required question still empty;
// 3. anything still unanswered, or a check only a person can do: stop, the student finishes it;
// 4. a dry run stops here, filled in;
// 5. tell Pathfinder "submitting" and only if it agrees, press Submit, once;
// 6. report only what the page shows: a confirmation is "applied"; silence is "uncertain".

import { fileFrom, labelOf, until } from "./fill";
import { boardFor } from "./boards";
import { challengeShown, emptyRequired, fill, outcome, readFields, type Board, type Files } from "./form";
import { REASONS, type Answer, type DocumentFile, type FormAnswers, type LeasedTask, type Reply, type Report, type TabRequest } from "./protocol";

/** How the tab talks to the background (chrome.runtime.sendMessage in the extension; a fake in tests). */
export type Port = <T>(request: TabRequest) => Promise<Reply<T>>;

/** The task this tab was opened for, and whether Submit was already pressed (the page navigated since). */
export type TabTask = { task: LeasedTask; submitted: boolean };

/** Report outcomes and whether the tab stays open for the student. */
export type Finish = { report: Report; keepTab: boolean };

export const WAIT = { form: 20_000, confirmation: 60_000 };

async function ask<T>(port: Port, request: TabRequest): Promise<T> {
  const reply = await port<T>(request);
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

const needsStudent = (reason: string, keepTab = true): Finish => ({ report: { outcome: "needs-student", reason }, keepTab });

/** After Submit: what the page says, within the wait. */
export async function afterSubmit(board: Board, doc: Document, location: Location | { pathname: string; href: string }, wait = WAIT.confirmation): Promise<Finish> {
  const seen = await until(() => outcome(board, doc, location), { timeout: wait, every: 500 });
  if (!seen) return { report: { outcome: "uncertain", reason: REASONS.noAnswer }, keepTab: true };
  switch (seen.kind) {
    case "confirmed":
      return { report: { outcome: "applied", evidence: { url: location.href.slice(0, 2000), text: seen.text.slice(0, 500) } }, keepTab: false };
    case "challenge":
      return needsStudent(REASONS.challenge);
    case "email-code":
      return needsStudent(REASONS.emailCode);
    case "error":
      return needsStudent(REASONS.formError(seen.text));
  }
}

/** The PDFs the answers attach, fetched once each. */
async function documents(port: Port, task: LeasedTask, answers: Record<string, Answer>, have: Files = {}): Promise<Files> {
  const wanted = new Set(Object.values(answers).flatMap((answer) => (answer.kind === "file" ? [answer.file] : [])));
  const files: Files = { ...have };
  if (wanted.has("resume") && task.documents.resume && !files.resume) files.resume = fileFrom(await ask<DocumentFile>(port, { type: "document", kind: "resume" }));
  if (wanted.has("cover_letter") && task.documents.coverLetter && !files.cover_letter) files.cover_letter = fileFrom(await ask<DocumentFile>(port, { type: "document", kind: "letter" }));
  return files;
}

/** Fills the form and, unless it's a dry run, submits it. Returns what to report. */
export async function apply(port: Port, doc: Document, location: Location | { hostname: string; pathname: string; href: string }, { task, submitted }: TabTask): Promise<Finish> {
  const board = boardFor(location.hostname);
  if (!board) return needsStudent(REASONS.noForm, false);
  // The page after Submit (Greenhouse and Lever load a new one): only see what it says.
  if (submitted) return afterSubmit(board, doc, location);

  const form = await until(() => board.findForm(doc), { timeout: WAIT.form });
  if (!form) return challengeShown(doc) ? needsStudent(REASONS.challenge) : needsStudent(REASONS.noForm, false);

  // 2. The server's answers (it read Greenhouse's API), else the form as this page shows it.
  const first: FormAnswers = task.answers ? { answers: task.answers, missing: [] } : await ask<FormAnswers>(port, { type: "answers", fields: await readFields(board, form) });
  const answers: Record<string, Answer> = { ...first.answers };
  // The tailored resume (and letter) go in wherever the form takes them, asked for or not.
  for (const question of board.questions(form)) {
    if (question.control.kind !== "file" || answers[question.key]) continue;
    if (/resume|\bcv\b/i.test(question.label) && task.documents.resume) answers[question.key] = { kind: "file", file: "resume" };
    else if (/cover/i.test(question.label) && task.documents.coverLetter) answers[question.key] = { kind: "file", file: "cover_letter" };
  }
  const files = await documents(port, task, answers);
  // What couldn't be filled shows up below as still empty, if it's required; optional ones don't matter.
  await fill(board, form, answers, files);

  // Questions the page shows that the server's copy didn't have (demographics, a consent box).
  const empty = await emptyRequired(board, form);
  if (empty.length > 0) {
    const more = await ask<FormAnswers>(port, { type: "answers", fields: empty });
    await fill(board, form, more.answers, await documents(port, task, more.answers, files));
  }
  const missing = [...new Set((await emptyRequired(board, form)).map((field) => field.label))];
  if (missing.length > 0) return needsStudent(REASONS.unanswered(missing));

  // 3. and 4.
  if (challengeShown(doc)) return needsStudent(REASONS.challenge);
  if (task.dryRun) return { report: { outcome: "dry-run" }, keepTab: true };

  // The browser's own required check would stop Submit silently: whatever it objects to is the student's.
  if (form instanceof HTMLFormElement && !form.noValidate && !form.checkValidity()) {
    const invalid = Array.from(form.querySelectorAll<HTMLInputElement>(":invalid")).map((element) => labelOf(element) || element.name || element.id).filter(Boolean);
    return needsStudent(REASONS.unanswered(invalid.length > 0 ? [...new Set(invalid)] : ["a required question on the form"]));
  }

  // 5. Pathfinder must agree first: if this browser lost the task, Submit is never pressed.
  const button = board.submitButton(form);
  if (!button) return { report: { outcome: "failed", reason: REASONS.noForm }, keepTab: false };
  await ask<null>(port, { type: "report", report: { outcome: "submitting" } });
  button.click();

  // 6.
  return afterSubmit(board, doc, location);
}

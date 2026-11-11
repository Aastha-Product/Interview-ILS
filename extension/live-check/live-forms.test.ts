import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { answerForm, type FormField } from "../../src/lib/apply/answers";
import { formFields } from "../../src/lib/apply/greenhouse-form";
import { student } from "../e2e/fake-pathfinder";
import { boardFor } from "../src/boards";
import { readFields } from "../src/form";

// The live forms saved by capture.mjs, read with the extension's own board code and answered by the
// server's own rules for a made-up student (Asha Rao, the Chrome tests' student). Nothing here
// touches a job board except Greenhouse's public questions API, which the server reads too.
// Skipped unless PATHFINDER_LIVE_FORMS names the folder (see capture.mjs).

const DIR = process.env.PATHFINDER_LIVE_FORMS;

/** The Chrome tests' student, with the salaries Set up job search asks for filled in, as a student would. */
const asha = (company: string) => {
  const context = student(company);
  // Everything Set up job search requires: the cities they'd work in, working from the office, the salaries.
  return { ...context, cities: ["Pune", "Bengaluru", "Noida"], saved: { ...context.saved, onsiteOk: true, currentSalary: "3 LPA", expectedSalary: "6 LPA", graduationYear: "2026" } };
};

type Saved = { board: string; company: string; title: string; url: string; file: string; finalUrl: string; formFound: boolean; location?: string };
type Finding = {
  page: string;
  url: string;
  questions: number;
  required: number;
  answered: number;
  toStudent: string[];
  problems: string[];
};

const greenhouseApi = async (url: string): Promise<FormField[]> => {
  const [, token, , id] = new URL(url).pathname.split("/");
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${id}?questions=true`);
  return formFields(await response.json());
};

describe.skipIf(!DIR)("today's live application forms", () => {
  it("are read and answered as the extension and the server would", { timeout: 600_000 }, async () => {
    const saved = JSON.parse(await readFile(join(DIR!, "index.json"), "utf8")) as Saved[];
    const findings: Finding[] = [];
    for (const page of saved) {
      const name = `${page.board} ${page.company}: ${page.title.trim()}`;
      const problems: string[] = [];
      const html = await readFile(join(DIR!, page.file), "utf8").catch(() => "");
      document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, "");
      const board = boardFor(new URL(page.finalUrl).hostname);
      const form = board?.findForm(document) ?? null;
      if (!board) problems.push(`moved to another site: ${page.finalUrl}`);
      else if (!form) problems.push("the extension doesn't find the form");
      const questions = form && board ? board.questions(form) : [];
      if (form && board && !board.submitButton(form)) problems.push("no Submit button found");
      if (form && !questions.some((question) => question.control.kind === "file")) problems.push("no file input for the resume");
      for (const question of questions) {
        if (!question.label || question.label === question.key) problems.push(`no wording read for "${question.key}"`);
      }

      // What the server answers: Greenhouse from its API (keys the extension then fills by), the
      // others from what the extension reads on the page.
      let fields: FormField[] = [];
      if (board?.name === "greenhouse") {
        fields = await greenhouseApi(page.finalUrl);
        const onPage = new Set(questions.map((question) => question.key.replace(/\[\]$/, "")));
        // The API's fields that aren't on the page are skipped when filling (fill() in form.ts);
        // a required one is then still empty and asked again, as below.
        void onPage;
        // Required questions the API leaves out (Country, a demographic consent): the extension reads
        // them off the page and asks the server, as run.ts does.
        const inApi = new Set(fields.map((field) => field.key.replace(/\[\]$/, "")));
        const pageOnly = new Set(questions.filter((question) => question.required && !inApi.has(question.key.replace(/\[\]$/, ""))).map((question) => question.key));
        if (form && board && pageOnly.size > 0) fields = [...fields, ...(await readFields(board, form)).filter((field) => pageOnly.has(field.key))];
      } else if (form && board) {
        fields = await readFields(board, form);
      }
      const { missing } = answerForm(fields, { ...asha(page.company), jobLocation: page.location ?? "" });
      const required = fields.filter((field) => field.required && field.type !== "hidden");
      const toStudent = missing;
      for (const question of questions) if (question.control.kind === "other" && question.required) problems.push(`"${question.label}" has several inputs: goes to the student`);
      findings.push({
        page: name,
        url: page.url,
        questions: questions.length,
        required: required.length,
        answered: required.length - missing.length,
        toStudent,
        problems,
      });
      expect.soft(form, name).not.toBeNull();
    }

    await writeFile(join(DIR!, "report.json"), `${JSON.stringify(findings, null, 2)}\n`);
    const complete = findings.filter((finding) => finding.toStudent.length === 0 && finding.problems.length === 0).length;
    console.log(`LIVE-FORMS ${findings.length} forms; ${complete} would be filled completely with no problems`);
    for (const finding of findings) {
      console.log(
        `LIVE-FORM ${finding.page} | ${finding.questions} questions, ${finding.answered}/${finding.required} required answered` +
          (finding.toStudent.length ? ` | to the student: ${finding.toStudent.join("; ")}` : "") +
          (finding.problems.length ? ` | PROBLEMS: ${finding.problems.join("; ")}` : ""),
      );
    }
  });
});

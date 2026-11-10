import "server-only";

import { z } from "zod";

import { CrawlError, getJson } from "@/lib/crawl/http";

import type { FieldType, FormField } from "./answers";

// Pathfinder (auto-apply step 4): a Greenhouse job's application form, from the board's public API
// (GET …/jobs/{id}?questions=true), so the server can answer it before any browser opens it. A
// question can offer two fields (a resume file, or the resume as text): the file is the one used.

const TYPES: Record<string, FieldType> = {
  input_text: "text",
  textarea: "textarea",
  input_file: "file",
  multi_value_single_select: "single",
  multi_value_multi_select: "multi",
  input_hidden: "hidden",
};

const text = z.string().nullish().catch(null);
const questionSchema = z.object({
  label: text,
  required: z.boolean().nullish().catch(false),
  fields: z.array(
    z.object({
      name: z.string().min(1),
      type: z.string(),
      values: z.array(z.object({ label: z.union([z.string(), z.number()]).transform(String), value: z.union([z.string(), z.number()]).transform(String) })).nullish().catch(null),
    }),
  ),
});
const formSchema = z.object({
  questions: z.array(z.unknown()).nullish().catch(null),
  location_questions: z.array(z.unknown()).nullish().catch(null),
});

/** The form's fields; for each question, its file field when it offers one, else its first. */
export function formFields(answer: unknown): FormField[] {
  const form = formSchema.safeParse(answer);
  if (!form.success) throw new CrawlError("changed", "Greenhouse answered a job's form in an unexpected shape.");
  const fields: FormField[] = [];
  for (const raw of [...(form.data.questions ?? []), ...(form.data.location_questions ?? [])]) {
    const question = questionSchema.safeParse(raw);
    if (!question.success || question.data.fields.length === 0) continue;
    const chosen = question.data.fields.find((entry) => entry.type === "input_file") ?? question.data.fields[0];
    fields.push({
      key: chosen.name,
      label: question.data.label ?? chosen.name,
      required: question.data.required ?? false,
      type: TYPES[chosen.type] ?? "text",
      options: chosen.values ?? [],
    });
  }
  return fields;
}

/** Reads a Greenhouse job's form. */
export async function greenhouseForm(boardToken: string, jobId: string, signal: AbortSignal): Promise<FormField[]> {
  const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobId)}`);
  url.searchParams.set("questions", "true");
  return formFields(await getJson("GREENHOUSE", url, signal));
}

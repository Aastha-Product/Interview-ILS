import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jobs/rate-limit", () => ({ withRateLimit: (_p: string, _l: unknown, work: () => unknown) => work() }));

const { formFields } = await import("./greenhouse-form");

describe("reading a Greenhouse form (auto-apply step 4)", () => {
  it("takes each question's file field when it offers one, and its options", () => {
    // Shaped like Greenhouse's answer for a Groww job on 10 November 2026.
    const fields = formFields({
      questions: [
        { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text", values: [] }] },
        {
          label: "Resume/CV",
          required: true,
          fields: [
            { name: "resume", type: "input_file", values: [] },
            { name: "resume_text", type: "textarea", values: [] },
          ],
        },
        {
          label: "Do you have a relative working at Groww?",
          required: true,
          fields: [{ name: "question_9611894101", type: "multi_value_single_select", values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }],
        },
        { label: "Broken", fields: [] },
      ],
      location_questions: [{ label: "Longitude", required: true, fields: [{ name: "longitude", type: "input_hidden", values: [] }] }],
    });
    expect(fields).toEqual([
      { key: "first_name", label: "First Name", required: true, type: "text", options: [] },
      { key: "resume", label: "Resume/CV", required: true, type: "file", options: [] },
      {
        key: "question_9611894101",
        label: "Do you have a relative working at Groww?",
        required: true,
        type: "single",
        options: [
          { label: "Yes", value: "1" },
          { label: "No", value: "0" },
        ],
      },
      { key: "longitude", label: "Longitude", required: true, type: "hidden", options: [] },
    ]);
  });

  it("says when the form comes in a shape it doesn't know", () => {
    expect(() => formFields("not a form")).toThrow("Greenhouse answered a job's form in an unexpected shape.");
  });
});

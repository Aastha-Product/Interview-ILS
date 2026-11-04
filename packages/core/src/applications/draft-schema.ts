import { z } from "zod";

// Validation for drafts the student edits by hand. Limits keep documents a sensible size.
const text = (max: number) => z.string().trim().max(max);

const bullet = z.object({
  id: text(64).min(1),
  text: text(400),
  factIds: z.array(text(64)).max(20).default([]),
  editedByStudent: z.boolean().optional(),
});

export const resumeContentSchema = z.object({
  header: z.object({
    name: text(120),
    email: text(200),
    phone: text(30),
    location: text(120),
    links: z
      .array(z.object({ label: text(40), url: text(300).refine((u) => u === "" || /^https?:\/\//i.test(u), "Links must start with https://") }))
      .max(10),
  }),
  headline: text(150),
  summary: z.object({ text: text(1200), factIds: z.array(text(64)).max(20).default([]), editedByStudent: z.boolean().optional() }),
  skills: z.array(text(60).min(1)).max(40),
  experiences: z
    .array(
      z.object({
        sourceId: text(64),
        title: text(150),
        company: text(150),
        location: text(120),
        dates: text(60),
        bullets: z.array(bullet).max(8),
      }),
    )
    .max(20),
  projects: z
    .array(
      z.object({
        sourceId: text(64),
        name: text(150),
        role: text(100),
        technologies: z.array(text(50)).max(20),
        url: text(300),
        dates: text(60),
        bullets: z.array(bullet).max(8),
      }),
    )
    .max(20),
  education: z
    .array(
      z.object({
        sourceId: text(64),
        institution: text(200),
        degree: text(120),
        field: text(120),
        dates: text(60),
        grade: text(50),
      }),
    )
    .max(10),
});

export const answersContentSchema = z.object({
  answers: z
    .array(
      z.object({
        id: text(64).min(1),
        question: text(300),
        answer: text(2000),
        factIds: z.array(text(64)).max(20).default([]),
        needsInput: z.boolean(),
        note: text(300),
        editedByStudent: z.boolean().optional(),
      }),
    )
    .max(8),
});

import { z } from "zod";

// Pathfinder: the site-wide assistant (Phase 1). It answers questions about Pathfinder and points
// the student to the right screen. It can't change anything yet — later phases add actions behind a
// confirmation. The model only ever replies in the shape of `assistantReplySchema`, and the one
// place it can send the student is a screen from this list, so a page's own text can never steer it
// somewhere else.

/** A screen the assistant may send the student to. `tool` ones exist only where the job tools are on. */
export type Destination = { path: string; label: string; hint: string; tool: boolean };

export const DESTINATIONS: readonly Destination[] = [
  { path: "/", label: "Home", hint: "Upload a resume and read its analysis.", tool: false },
  { path: "/resume", label: "Base resume", hint: "The resume built from the profile, its theme, page fit and PDF.", tool: false },
  { path: "/profile", label: "Profile", hint: "Edit the experience, skills and details the resume is built from.", tool: false },
  { path: "/settings", label: "Settings", hint: "AI provider, resume language and length, job search, account.", tool: false },
  { path: "/jobs", label: "Find jobs", hint: "Search job postings and save the good ones.", tool: true },
  { path: "/agent", label: "Job agent", hint: "The daily search that scores new postings against the profile.", tool: true },
  { path: "/applications", label: "Applications", hint: "Track applications and their tailored documents.", tool: true },
  { path: "/auto-apply", label: "Auto-apply", hint: "Set up and watch automatic applications.", tool: true },
];

/** The screens on offer now: the always-on ones, plus the job tools where this server has them on. */
export function availableDestinations(toolsOn: boolean): Destination[] {
  return DESTINATIONS.filter((destination) => toolsOn || !destination.tool);
}

/** The reply the model must return: an answer, and at most one screen to offer a link to. */
export function assistantReplySchema(paths: readonly string[]) {
  const path = paths.length > 0 ? z.enum(paths as [string, ...string[]]) : z.string();
  return z.object({
    /** The answer to show the student, in plain language. */
    text: z.string().min(1).max(4000),
    /** A screen to offer a link to, or null for none. One of the available paths. */
    navigate: path.nullable().catch(null),
  });
}

export type AssistantReply = z.output<ReturnType<typeof assistantReplySchema>>;

/** The destination's label, for the "Open <label>" link the panel shows; falls back to the path. */
export function destinationLabel(path: string): string {
  return DESTINATIONS.find((destination) => destination.path === path)?.label ?? path;
}

const INSTRUCTIONS = `You are the Pathfinder assistant. Pathfinder helps students improve their resume, find jobs and apply.

Help the student with what they ask: explain how Pathfinder works, explain what's on the screen they're on, and help them find the right screen. Be brief, warm and concrete — a sentence or two, not an essay. Use the student's own words back to them.

You cannot change anything yet: you can't edit the profile, change settings, search, or apply. If the student asks you to do something like that, say you can't do it for them yet and point them to the screen where they can do it themselves.

When a screen would help, set "navigate" to its path (exactly as listed) and refer to it by name; the student gets a button to open it. Use only a path from the list. If no screen fits, set "navigate" to null. Never invent features Pathfinder doesn't have.`;

/** The system prompt: what the assistant is, the screens it can point to, and where the student is now. */
export function assistantSystem(destinations: readonly Destination[], currentPath: string): string {
  const screens = destinations.map((destination) => `- ${destination.path} (${destination.label}): ${destination.hint}`).join("\n");
  const here = destinations.find((destination) => destination.path === currentPath);
  const where = here ? `The student is on ${here.path} (${here.label}) right now.` : "The student is somewhere in Pathfinder.";
  return `${INSTRUCTIONS}\n\nScreens you can point to:\n${screens}\n\n${where}`;
}

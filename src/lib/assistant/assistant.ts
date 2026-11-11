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

/** For the system prompt and the proposal enum: a tool the assistant may propose, named and described. */
export type ToolInfo = { name: string; description: string };

/**
 * The reply the model must return: an answer, at most one screen to link to, and at most one action
 * to propose. A proposal never runs on its own — the student confirms it first (Phase 2). Its args
 * are strings keyed by field; the server validates them against the specific tool before anything.
 */
export function assistantReplySchema(paths: readonly string[], toolNames: readonly string[]) {
  const path = paths.length > 0 ? z.enum(paths as [string, ...string[]]) : z.string();
  const tool = toolNames.length > 0 ? z.enum(toolNames as [string, ...string[]]) : z.string();
  return z.object({
    /** The answer to show the student, in plain language. */
    text: z.string().min(1).max(4000),
    /** A screen to offer a link to, or null for none. One of the available paths. */
    navigate: path.nullable().catch(null),
    /** An action to propose (the student confirms it), or null for none. */
    proposal: z
      .object({ tool, args: z.record(z.string(), z.string()) })
      .nullable()
      .catch(null),
  });
}

export type AssistantReply = z.output<ReturnType<typeof assistantReplySchema>>;

/** The destination's label, for the "Open <label>" link the panel shows; falls back to the path. */
export function destinationLabel(path: string): string {
  return DESTINATIONS.find((destination) => destination.path === path)?.label ?? path;
}

const INSTRUCTIONS = `You are the Pathfinder assistant. Pathfinder helps students improve their resume, find jobs and apply.

Help the student with what they ask: explain how Pathfinder works, explain what's on the screen they're on, help them find the right screen, and — for the actions listed below — make the change for them.

Be brief, warm and concrete — a sentence or two, not an essay. Use the student's own words back to them.

Making a change: when the student clearly asks for one of the actions below, set "proposal" to { "tool": the action's name, "args": its arguments as named }. Don't run it in your head — the student sees a short summary and confirms before anything happens, so your "text" should say what you're about to do, not that it's done. Only propose an action the student actually asked for, propose at most one at a time, and put only the fields they want to change in "args". For anything not in the list — sending an email, applying to a job, deleting things — say you can't do that one and point them to the screen where they can.

When a screen would help, set "navigate" to its path (exactly as listed) and refer to it by name; the student gets a button to open it. Use only a path from the list, or null. Never invent features, screens or actions Pathfinder doesn't have.`;

/** The system prompt: what the assistant is, the actions and screens it has, and where the student is now. */
export function assistantSystem(destinations: readonly Destination[], tools: readonly ToolInfo[], currentPath: string): string {
  const screens = destinations.map((destination) => `- ${destination.path} (${destination.label}): ${destination.hint}`).join("\n");
  const actions = tools.length > 0 ? tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n") : "- (no actions available)";
  const here = destinations.find((destination) => destination.path === currentPath);
  const where = here ? `The student is on ${here.path} (${here.label}) right now.` : "The student is somewhere in Pathfinder.";
  return `${INSTRUCTIONS}\n\nActions you can propose (each needs the student's confirmation):\n${actions}\n\nScreens you can point to:\n${screens}\n\n${where}`;
}

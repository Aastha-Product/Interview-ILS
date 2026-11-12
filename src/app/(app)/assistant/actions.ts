"use server";

import { z } from "zod";

import { getAiProvider, AiError } from "@/lib/ai";
import { ActionError, action } from "@/lib/action";
import { loadApplicationRows } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";
import { assistantReplySchema, assistantSystem, availableDestinations, type AppInfo } from "@/lib/assistant/assistant";
import { assistantTool, toolInfos } from "@/lib/assistant/tools";
import { toolsEnabled } from "@/lib/tools";

/** The student's applications (newest first, capped) for the prompt, so the assistant can act on one by id. */
async function applicationsForPrompt(): Promise<AppInfo[]> {
  if (!toolsEnabled()) return [];
  const rows = await loadApplicationRows({ archived: false, sort: DEFAULT_SORT }).catch(() => []);
  return rows.slice(0, 20).map((row) => ({ id: row.id, company: row.company, role: row.role, status: row.status }));
}

// Pathfinder assistant: the chat action and the one that runs a confirmed action. askAssistant reads
// and proposes only — it never changes anything. runAssistantTool makes the change, and only after
// the student confirmed it in the panel; it re-checks the args, so a tampered request can't slip
// past. Both run as the signed-in student, and AI calls count against the daily limit.

const MAX_TURNS = 24;
const MAX_CHARS = 4000;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_CHARS),
});

/** A change the assistant offers to make; the panel shows `summary` and runs it only on confirm. */
export type AssistantProposal = { tool: string; args: Record<string, string>; summary: string };

/** What the panel shows for one reply: the answer, a screen to link to, and an action to confirm. */
export type AssistantAnswer = { text: string; navigate: string | null; proposal: AssistantProposal | null };

/**
 * Answers the student in the assistant panel. The newest message is theirs; earlier ones give the
 * thread. `path` is the screen they're on. Returns the reply, at most one screen to link to, and at
 * most one action to confirm — the action is validated here but not run.
 */
export const askAssistant = action(
  z.object({
    messages: z.array(messageSchema).min(1).max(MAX_TURNS),
    path: z.string().max(200).default("/"),
  }),
  async ({ messages, path }): Promise<AssistantAnswer> => {
    if (messages.at(-1)?.role !== "user") throw new ActionError("Ask a question first.");

    const destinations = availableDestinations(toolsEnabled());
    const schema = assistantReplySchema();

    let provider;
    try {
      provider = await getAiProvider();
    } catch {
      throw new ActionError("The assistant isn't set up on this server yet. Add an AI provider in Settings → AI.");
    }

    let reply;
    try {
      reply = await provider.complete({
        system: assistantSystem(destinations, toolInfos(), await applicationsForPrompt(), path),
        messages,
        schema,
        schemaName: "assistant_reply",
      });
    } catch (error) {
      if (error instanceof AiError) throw new ActionError(error.message);
      throw error;
    }

    // The model returns plain strings; we check them here (the schema can't, so Gemini accepts it).
    const navigate = reply.navigate && destinations.some((destination) => destination.path === reply.navigate) ? reply.navigate : null;
    return { text: reply.text, navigate, proposal: validateProposal(reply.proposal) };
  },
);

/**
 * The model's proposal, kept only when it names a real tool and its args pass that tool's checks.
 * `args` arrives as a JSON string (Gemini can't return an open-ended object), so it's parsed here.
 */
function validateProposal(proposal: { tool: string; args: string } | null): AssistantProposal | null {
  if (!proposal) return null;
  const tool = assistantTool(proposal.tool);
  if (!tool) return null;
  let args: unknown;
  try {
    args = JSON.parse(proposal.args);
  } catch {
    return null;
  }
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) return null;
  return { tool: tool.name, args: args as Record<string, string>, summary: tool.summarize(parsed.data) };
}

/**
 * Makes a change the student confirmed in the panel (Phase 2). The args are checked again against
 * the tool, so nothing runs on a request the tool wouldn't accept. Returns a short "done" sentence.
 */
export const runAssistantTool = action(
  z.object({ tool: z.string().min(1).max(100), args: z.record(z.string(), z.string()) }),
  async ({ tool: name, args }): Promise<{ done: string }> => {
    const tool = assistantTool(name);
    if (!tool) throw new ActionError("That action isn't available.");
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) throw new ActionError("Something about that change didn't look right. Try asking again.");
    return { done: await tool.run(parsed.data) };
  },
);

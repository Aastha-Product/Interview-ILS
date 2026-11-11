"use server";

import { z } from "zod";

import { getAiProvider, AiError } from "@/lib/ai";
import { ActionError, action } from "@/lib/action";
import { assistantReplySchema, assistantSystem, availableDestinations, type AssistantReply } from "@/lib/assistant/assistant";
import { toolsEnabled } from "@/lib/tools";

// Pathfinder: the assistant's one server action (Phase 1). It takes the conversation so far and the
// screen the student is on, asks the AI provider for a reply in the fixed shape, and hands it back.
// It changes nothing — reading and pointing to screens only. AI calls count against the student's
// daily limit, like any other (getAiProvider).

const MAX_TURNS = 24;
const MAX_CHARS = 4000;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_CHARS),
});

/**
 * Answers the student in the assistant panel. The newest message is theirs; earlier ones give the
 * assistant the thread. `path` is the screen they're on, so the answer can speak to it. Returns the
 * reply and at most one screen to offer a link to.
 */
export const askAssistant = action(
  z.object({
    messages: z.array(messageSchema).min(1).max(MAX_TURNS),
    path: z.string().max(200).default("/"),
  }),
  async ({ messages, path }): Promise<AssistantReply> => {
    if (messages.at(-1)?.role !== "user") throw new ActionError("Ask a question first.");

    const destinations = availableDestinations(toolsEnabled());
    const schema = assistantReplySchema(destinations.map((destination) => destination.path));

    let provider;
    try {
      provider = await getAiProvider();
    } catch {
      throw new ActionError("The assistant isn't set up on this server yet. Add an AI provider in Settings → AI.");
    }

    try {
      return await provider.complete({
        system: assistantSystem(destinations, path),
        messages,
        schema,
        schemaName: "assistant_reply",
      });
    } catch (error) {
      if (error instanceof AiError) throw new ActionError(error.message);
      throw error;
    }
  },
);

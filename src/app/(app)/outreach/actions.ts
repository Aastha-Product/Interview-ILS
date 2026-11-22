"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ActionError, toolAction } from "@/lib/action";
import { AiError } from "@/lib/ai/errors";
import { GoogleError } from "@/lib/google/errors";
import { draftOutreach, OutreachError, saveOutreach, sendOutreach } from "@/lib/outreach-data";

// Pathfinder (Phase 3): Outreach's actions. Drafting only writes a draft; sending is its own,
// confirmed request.

const refresh = (applicationId: string) => {
  revalidatePath("/outreach");
  revalidatePath(`/outreach/${applicationId}`);
};

/** Turns the errors a student can act on into their message. */
async function plain<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OutreachError || error instanceof GoogleError || error instanceof AiError) throw new ActionError(error.message);
    throw error;
  }
}

const id = z.string().min(1).max(100);

export const saveOutreachDraft = toolAction(
  z.object({
    applicationId: id,
    contactName: z.string().max(200).optional(),
    contactEmail: z.string().max(300).optional(),
    subject: z.string().max(400).optional(),
    body: z.string().max(8000).optional(),
    linkedinNote: z.string().max(600).optional(),
    followUpBody: z.string().max(8000).optional(),
  }),
  async ({ applicationId, ...fields }) => {
    await plain(() => saveOutreach(applicationId, fields));
    refresh(applicationId);
    return null;
  },
);

export const draftOutreachEmail = toolAction(z.object({ applicationId: id }), async ({ applicationId }, { toast }) => {
  const which = await plain(() => draftOutreach(applicationId));
  refresh(applicationId);
  toast(which === "first" ? "Drafted. Read it and make it yours before you send it." : "Follow-up drafted. Read it before you send it.");
  return null;
});

export const sendOutreachEmail = toolAction(z.object({ applicationId: id }), async ({ applicationId }, { toast }) => {
  const which = await plain(() => sendOutreach(applicationId));
  refresh(applicationId);
  toast(which === "first" ? "Sent from your Gmail. Replies show up here and in Inbox." : "Follow-up sent in the same thread.");
  return null;
});

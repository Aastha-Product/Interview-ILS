"use server";

import { z } from "zod";

import { action } from "@/lib/action";
import { prisma } from "@/lib/prisma";

/** Saves a tester's feedback (Pathfinder, first testing release), with the page it's about. */
export const sendFeedback = action(
  z.object({
    message: z.string().trim().min(1, { error: "Write what happened or what you'd change." }).max(5000),
    page: z.string().max(300).default(""),
  }),
  async ({ message, page }, { toast }) => {
    await prisma.feedback.create({ data: { message, page: page.startsWith("/") ? page : "" } });
    toast("Thanks: your feedback was sent to the team.");
    return null;
  },
);

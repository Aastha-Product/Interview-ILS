import { NextResponse } from "next/server";
import { z } from "zod";

import { answerForm } from "@/lib/apply/answers";
import { heldTask } from "@/lib/apply/lease";
import { answerContext } from "@/lib/apply/prepare";
import { extensionError, extensionRoute } from "@/lib/extension/route";
import { systemPrisma } from "@/lib/prisma";

const fieldSchema = z.object({
  key: z.string().min(1).max(300),
  label: z.string().max(2000),
  required: z.boolean(),
  type: z.enum(["text", "textarea", "file", "single", "multi", "hidden"]),
  options: z.array(z.object({ label: z.string().max(500), value: z.string().max(500) })).max(300),
});
const bodySchema = z.object({ leaseId: z.string().min(1), fields: z.array(fieldSchema).max(200) });

/**
 * Pathfinder (step 5): answers for a form the extension read (Lever, Ashby), from the profile and
 * the saved answers, the same way Greenhouse forms are answered on the server. Only for the
 * browser holding the task.
 */
export const POST = extensionRoute<RouteContext<"/api/ext/tasks/[id]/answers">>(async (request, { params }) => {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return extensionError(400, "That form couldn't be read.");
  const task = await heldTask((await params).id, body.data.leaseId);
  if (!task) return extensionError(409, "This application isn't held by this browser any more.");
  const posting = await systemPrisma.sharedPosting.findUnique({ where: { id: task.sharedPostingId }, select: { companyName: true, location: true } });
  return NextResponse.json(answerForm(body.data.fields, await answerContext(posting?.companyName ?? "", posting?.location ?? "")));
});

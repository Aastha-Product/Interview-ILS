import { confirmsEmail, deleteAccount, getConfig, UserFacingError } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionCookieName } from "@/server/dev-sign-in";
import { readJson, withUser } from "@/server/http";
import { getFileStorage } from "@/server/services";

export const runtime = "nodejs";

const deleteSchema = z.object({ confirmEmail: z.string().min(1).max(320) });

/**
 * DELETE /api/account { confirmEmail }: permanently deletes the account, every row the student
 * owns and every file they stored. The student must type their email to confirm. Their sessions
 * are deleted with the account, so every signed-in browser is signed out.
 */
export const DELETE = withUser(async ({ request, user }) => {
  const body = deleteSchema.parse(await readJson(request));
  if (!confirmsEmail(body.confirmEmail, user.email)) {
    throw new UserFacingError("CONFIRMATION_MISMATCH", "That doesn't match your email address, so nothing was deleted.", 400);
  }
  await deleteAccount(user.id, { storage: getFileStorage(), hashSecret: getConfig().AUTH_SECRET });
  const response = NextResponse.json({ deleted: true });
  // The session row is already gone; clear the cookie too so the browser forgets it.
  response.cookies.set(sessionCookieName(), "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  return response;
});

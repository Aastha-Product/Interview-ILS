import "server-only";

import { headers } from "next/headers";

import { verifySession } from "@/lib/auth/session";
import { runAsUser } from "@/lib/owner/context";

import { PRINT_TOKEN_HEADER, printTokenStudent } from "./print-token";

/**
 * Lets the PDF renderer in with its print token, and anyone signed in (handy
 * for checking a print page in the browser); sends everyone else to /login.
 * Then loads the page's data with `load`: as the student the token names
 * (headless Chromium has no session), or as the signed-in student.
 */
export async function loadForPrint<T>(path: string, load: () => Promise<T>): Promise<T> {
  const userId = await printTokenStudent((await headers()).get(PRINT_TOKEN_HEADER), path);
  if (userId) return runAsUser(userId, load);
  await verifySession();
  return load();
}

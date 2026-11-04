import { getProfile } from "@pathfinder/core";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";

/** Sends new students to onboarding and everyone else to their dashboard. */
export default async function Home() {
  const { db } = await requireUser();
  const profile = await getProfile(db);
  redirect(profile.version === 0 ? "/onboarding" : "/dashboard");
}

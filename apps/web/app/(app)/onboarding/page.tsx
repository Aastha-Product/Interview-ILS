import { getProfile } from "@pathfinder/core";
import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage() {
  const { db } = await requireUser();
  const profile = await getProfile(db);
  return <OnboardingFlow currentVersion={profile.version} />;
}

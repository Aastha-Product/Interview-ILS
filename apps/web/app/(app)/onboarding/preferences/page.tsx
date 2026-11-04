import { getPreferences } from "@pathfinder/core";
import type { Metadata } from "next";
import { PreferencesForm } from "@/components/preferences-form";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Job preferences" };

export default async function OnboardingPreferencesPage() {
  const { db } = await requireUser();
  const preferences = await getPreferences(db);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-brand-700">Step 3 of 3</p>
        <h1 className="text-2xl font-semibold">What kind of job are you looking for?</h1>
        <p className="mt-1 text-slate-600">We use this to find and rank jobs for you. You can change it any time.</p>
      </div>
      <PreferencesForm initial={preferences} redirectTo="/profile?welcome=1" submitLabel="Finish setup" />
    </div>
  );
}

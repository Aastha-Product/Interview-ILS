import { getPreferences } from "@pathfinder/core";
import type { Metadata } from "next";
import { PreferencesForm } from "@/components/preferences-form";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Job preferences" };

export default async function PreferencesPage() {
  const { db } = await requireUser();
  const preferences = await getPreferences(db);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Job preferences</h1>
      <PreferencesForm initial={preferences} />
    </div>
  );
}

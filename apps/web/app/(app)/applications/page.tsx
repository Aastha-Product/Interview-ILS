import { listApplications } from "@pathfinder/core";
import type { Metadata } from "next";
import { Tracker } from "@/components/applications/tracker";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const { db } = await requireUser();
  const apps = await listApplications(db);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Applications</h1>
        <p className="mt-1 text-slate-600">
          Drag a card (or use its status menu) when something changes. Keeping this up to date is what makes your response rate
          accurate.
        </p>
      </div>
      <Tracker initial={apps} />
    </div>
  );
}

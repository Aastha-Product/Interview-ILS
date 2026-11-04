import { getApplication, UserFacingError } from "@pathfinder/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationWorkspace } from "@/components/applications/application-workspace";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  let view;
  try {
    view = await getApplication(db, id);
  } catch (error) {
    if (error instanceof UserFacingError && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="flex flex-col gap-4">
      <p>
        <Link href="/applications" className="text-sm text-brand-700 underline">
          ← All applications
        </Link>
      </p>
      <ApplicationWorkspace initial={view} />
    </div>
  );
}

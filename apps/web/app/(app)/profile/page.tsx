import { getProfile } from "@pathfinder/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileEditor } from "@/components/profile-editor";
import { Alert } from "@/components/ui/card";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { db } = await requireUser();
  const profile = await getProfile(db);
  if (profile.version === 0) redirect("/onboarding");
  const { welcome } = await searchParams;
  const { version, updatedAt, ...fields } = profile;
  void updatedAt;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Your profile</h1>
        <p className="mt-1 text-slate-600">
          Everything Pathfinder writes for you comes from here. Keep it accurate and up to date.{" "}
          <Link href="/onboarding" className="text-brand-700 underline">
            Import a resume again
          </Link>
        </p>
      </div>
      {welcome && (
        <Alert tone="success">
          You&apos;re all set. Job search and tailored applications arrive in the next update; for now, make your profile as
          strong as you can.
        </Alert>
      )}
      <ProfileEditor initial={fields} initialVersion={version} />
    </div>
  );
}

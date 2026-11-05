import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccountCard, ExportCard } from "@/components/account-settings";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user } = await requireUser();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Signed in as {user.email}. Read{" "}
          <Link href="/privacy" className="text-brand-700 underline">
            how Pathfinder uses your data
          </Link>
          .
        </p>
      </div>
      <ExportCard />
      {user.email && <DeleteAccountCard email={user.email} />}
    </div>
  );
}

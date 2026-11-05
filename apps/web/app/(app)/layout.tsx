import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/server/auth";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold text-brand-700">
            Pathfinder
          </Link>
          <Link href="/dashboard" className="text-sm text-slate-700 hover:text-slate-900">
            Dashboard
          </Link>
          <Link href="/jobs" className="text-sm text-slate-700 hover:text-slate-900">
            Jobs
          </Link>
          <Link href="/applications" className="text-sm text-slate-700 hover:text-slate-900">
            Applications
          </Link>
          <Link href="/profile" className="text-sm text-slate-700 hover:text-slate-900">
            Profile
          </Link>
          <Link href="/preferences" className="text-sm text-slate-700 hover:text-slate-900">
            Job preferences
          </Link>
          <Link href="/settings" className="text-sm text-slate-700 hover:text-slate-900">
            Settings
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">{user.email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

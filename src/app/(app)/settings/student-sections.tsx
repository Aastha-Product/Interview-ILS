import Link from "next/link";
import type { ReactNode } from "react";

import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { signOut } from "@/lib/auth/actions";

import { DangerZone } from "./data-section";
import { SettingsSectionIntro } from "./settings-screen";

// Pathfinder: Settings for students where the job-search tools are off. Nothing technical: the
// server runs the AI, so there's no provider, model or key to choose.

function Rows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <Card className="divide-y divide-line p-0">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3.5">
          <span className="text-sm text-muted">{label}</span>
          <span className="min-w-0 text-sm break-words text-ink">{value}</span>
        </div>
      ))}
    </Card>
  );
}

/** Who's signed in, and how to change the password or sign out. */
export function AccountSection({ email, name, canResetPassword }: { email: string; name: string; canResetPassword: boolean }) {
  return (
    <>
      <SettingsSectionIntro title="Account">Your sign-in details.</SettingsSectionIntro>
      <Rows
        rows={[
          { label: "Name", value: name || "Not set" },
          { label: "Email", value: email },
        ]}
      />
      <div className="flex flex-wrap gap-3">
        <Link href="/profile" className={buttonClassName("secondary", "md")}>
          Edit your profile
        </Link>
        {canResetPassword && (
          <Link href="/reset-password" className={buttonClassName("secondary", "md")}>
            Change password
          </Link>
        )}
        <form action={signOut}>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </div>
      {canResetPassword && (
        <p className="text-meta text-muted">
          Changing your password sends a link to your email address. If you sign in with Google, your password is managed by Google.
        </p>
      )}
    </>
  );
}

/** The student's plan: free for now, with today's allowance. */
export function PlanSection({ perDay, left }: { perDay: number | null; left: number | null }) {
  return (
    <>
      <SettingsSectionIntro title="Plan">What your account includes.</SettingsSectionIntro>
      <Rows
        rows={[
          { label: "Plan", value: "Free" },
          {
            label: "Resume analyses",
            value: perDay ? `${perDay} a day${left !== null ? ` · ${left} left today` : ""}` : "No daily limit",
          },
        ]}
      />
      <p className="text-sm text-muted">Paid plans with more analyses are coming soon. Your free plan stays free.</p>
    </>
  );
}

/** Where the student's data is, and deleting it. */
export function PrivacySection({ analyses }: { analyses: number }) {
  return (
    <>
      <SettingsSectionIntro title="Privacy and data">
        Your resume analyses and profile are private to your account. You can delete them at any time.
      </SettingsSectionIntro>
      <Rows
        rows={[
          { label: "Resume analyses", value: <Link href="/analyze" className="underline underline-offset-2">{analyses} saved</Link> },
          { label: "Privacy notice", value: <Link href="/privacy" className="underline underline-offset-2">How we handle your data</Link> },
        ]}
      />
      <p className="text-sm text-muted">To delete one analysis, open it and choose Delete. To delete everything at once, use the button below.</p>
      <DangerZone description="Deletes all your resume analyses, your profile and your settings. This can't be undone. Your account stays, so you can start again." />
    </>
  );
}

/** How to get help. */
export function HelpSection() {
  return (
    <>
      <SettingsSectionIntro title="Help">Something not working, or a question about your analysis?</SettingsSectionIntro>
      <div className="flex flex-wrap gap-3">
        <Link href="/feedback?from=/settings" className={buttonClassName("secondary", "md")}>
          Contact us
        </Link>
        <Link href="/privacy" className={buttonClassName("text", "md")}>
          Privacy notice
        </Link>
      </div>
    </>
  );
}

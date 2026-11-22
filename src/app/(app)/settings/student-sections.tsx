import Link from "next/link";
import type { ReactNode } from "react";

import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { signOut } from "@/lib/auth/actions";
import { PLAN_IDS, PLANS, priceText, type PlanId } from "@/lib/plans";

import { DangerZone } from "./data-section";
import { DeleteAccount } from "./delete-account";
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
const planUntil = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * The student's plan (Phase 4): the one they're on and until when, what it gives them today, and
 * what each plan includes. Checkout isn't open yet, so the paid plans say how to get one.
 */
export function PlanSection({ perDay, left, plan = "FREE", until = null }: { perDay: number | null; left: number | null; plan?: PlanId; until?: Date | null }) {
  const current = PLANS[plan];
  return (
    <>
      <SettingsSectionIntro title="Plan">What your account includes.</SettingsSectionIntro>
      <Rows
        rows={[
          { label: "Plan", value: `${current.name}${plan !== "FREE" ? (until ? ` · until ${planUntil.format(until)}` : " · no end date") : ""}` },
          {
            label: "Resume analyses",
            value: perDay ? `${perDay} a day${left !== null ? ` · ${left} left today` : ""}` : "No daily limit",
          },
          { label: "Auto-apply", value: `Up to ${current.applicationsPerDay} applications a day` },
        ]}
      />
      <ul aria-label="Plans" className="grid gap-3 sm:grid-cols-2">
        {PLAN_IDS.map((id) => {
          const entry = PLANS[id];
          return (
            <li key={id} aria-current={id === plan ? "true" : undefined} className={id === plan ? "flex flex-col gap-1 rounded-card border-2 border-primary px-4 py-3" : "flex flex-col gap-1 rounded-card border border-line-card px-4 py-3"}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{entry.name}</span>
                <span className="text-meta text-muted">{id === plan ? "Your plan" : priceText(entry)}</span>
              </span>
              <span className="text-meta text-muted">{entry.summary}</span>
              <span className="text-sm">
                {entry.analysesPerDay === null ? (perDay && plan === "FREE" ? `${perDay} analyses a day` : "Free analyses") : `${entry.analysesPerDay} analyses a day`} · up to{" "}
                {entry.applicationsPerDay} applications a day
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">
        {plan === "FREE"
          ? "Paying online opens soon. Until then the Pathfinder team can move you to a paid plan. Your free plan stays free."
          : "When your plan ends you go back to Free, and nothing you've made is lost."}
      </p>
    </>
  );
}

/** Where the student's data is, and deleting it. */
export function PrivacySection({ analyses, tools = false }: { analyses: number; /** The job-search tools are on, so there are applications too. */ tools?: boolean }) {
  const what = tools ? "resume analyses, profile and applications" : "resume analyses and profile";
  return (
    <>
      <SettingsSectionIntro title="Privacy and data">
        Your {what} are private to your account. You can delete them at any time.
      </SettingsSectionIntro>
      <Rows
        rows={[
          { label: "Resume analyses", value: <Link href="/analyze" className="underline underline-offset-2">{analyses} saved</Link> },
          { label: "Privacy notice", value: <Link href="/privacy" className="underline underline-offset-2">How we handle your data</Link> },
        ]}
      />
      <p className="text-sm text-muted">
        To delete one analysis, open it and choose Delete. To start over, delete everything and keep your account. To leave
        Pathfinder, delete your account.
      </p>
      <DangerZone
        description={`Deletes all your ${tools ? "resume analyses, applications, profile and settings" : "resume analyses, your profile and your settings"}. This can't be undone. Your account stays, so you can start again.`}
      />
      <DeleteAccount />
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

import { Check, FileSearch, FileUp, ListChecks, Lock, MousePointerClick, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2, UserRoundPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { buttonClassName } from "@/components/ui/button";
import { analysesPerDay } from "@/lib/ai/daily-limit";
import { signInMode } from "@/lib/auth/google-sign-in";
import { HOME_PATH } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { buyablePlans, pricedPlans } from "@/lib/billing";
import { env } from "@/lib/env";
import { priceText } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Resume analysis for students and graduates",
  description: "Upload your resume and get a clear analysis: what works, what to improve and what's missing. Free to start.",
};

/** The reference design's white-on-navy buttons in the hero and the closing band. */
const onNavyPrimary =
  "inline-flex items-center justify-center gap-2 rounded-control bg-white px-8 py-4 font-semibold text-brand-navy hover:text-brand-navy motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:scale-105";
const onNavyOutline =
  "inline-flex items-center justify-center gap-2 rounded-control border-2 border-white px-8 py-4 font-semibold text-white hover:bg-white hover:text-brand-navy motion-safe:transition-all motion-safe:duration-300 motion-safe:hover:scale-105";

/**
 * The public homepage (Pathfinder), shown at / to visitors who aren't signed in: what the service
 * does, how it works, the plans, and how resumes are kept private. Laid out as the reference
 * design's landing page: a navy bar, a navy-to-blue hero, step and feature cards on gray-50, a
 * white and a navy plan card, and a navy closing band.
 */
export default async function WelcomePage() {
  const signedIn = (await getSession()) !== null;
  const canSignUp = signInMode() === "firebase";
  const perDay = analysesPerDay();
  // The paid plans with the prices set on the server (Phase 4).
  const priced = pricedPlans(env);
  const canBuy = buyablePlans(env);
  const start = signedIn
    ? { href: HOME_PATH, label: "Go to your dashboard" }
    : { href: canSignUp ? "/signup" : "/login", label: "Get started free" };

  return (
    // Light, as the reference's landing page, whatever the visitor's scheme; its navy parts set their own.
    <div className="flex min-h-screen flex-col bg-white pt-16 text-ink light-page">
      <header className="on-navy fixed top-0 z-50 w-full">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 text-white hover:text-white">
            <BrandMark className="size-8" />
            <span className="text-xl font-bold">Pathfinder</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-6">
            <Link href="/open-jobs" className="hidden rounded-md px-3 py-2 text-on-brand-muted hover:text-white md:inline">
              Open jobs
            </Link>
            <Link href="/ats-checker" className="hidden rounded-md px-3 py-2 text-on-brand-muted hover:text-white md:inline">
              ATS checker
            </Link>
            <a href="#how" className="hidden rounded-md px-3 py-2 text-on-brand-muted hover:text-white md:inline">
              How it works
            </a>
            <a href="#auto-apply" className="hidden rounded-md px-3 py-2 text-on-brand-muted hover:text-white md:inline">
              Auto-apply
            </a>
            <a href="#plans" className="hidden rounded-md px-3 py-2 text-on-brand-muted hover:text-white md:inline">
              Plans
            </a>
            <a href="#privacy" className="hidden rounded-md px-3 py-2 text-on-brand-muted hover:text-white md:inline">
              Privacy
            </a>
            <a href="#faq" className="hidden rounded-md px-3 py-2 text-on-brand-muted hover:text-white lg:inline">
              FAQ
            </a>
            <div className="flex items-center gap-2 sm:gap-3">
              {!signedIn && (
                <Link href="/login" className={buttonClassName("secondary", "md", "px-3 sm:px-5")}>
                  Sign in
                </Link>
              )}
              <Link href={start.href} className={buttonClassName("primary", "md", "px-3 sm:px-5")}>
                {signedIn ? "Dashboard" : "Get started"}
              </Link>
            </div>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="bg-brand-gradient px-4 pt-20 pb-16 sm:pt-24">
          <div className="mx-auto grid max-w-7xl items-center gap-12 md:grid-cols-2">
            <div className="flex flex-col items-start gap-6">
              <p className="rounded-full border border-white/20 px-3 py-1 text-sm text-on-brand-muted">For students and graduates</p>
              <h1 className="text-4xl leading-tight font-bold text-balance text-white md:text-5xl">See your resume the way an employer will</h1>
              <p className="text-xl text-pretty text-on-brand-muted">
                Upload your resume and get a clear analysis: what works, what to improve, and what&apos;s missing. No setup, nothing to
                install. Free to start.
              </p>
              <div className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
                <Link href={start.href} className={onNavyPrimary}>
                  <FileUp className="size-5" aria-hidden="true" />
                  {start.label}
                </Link>
                {!signedIn && (
                  <a href="#how" className={onNavyOutline}>
                    <Sparkles className="size-5" aria-hidden="true" />
                    See how it works
                  </a>
                )}
              </div>
            </div>
            {/* What every analysis holds, where the reference shows its product. */}
            <div className="rounded-panel bg-white p-6 shadow-hero sm:p-8">
              <p className="text-sm font-medium text-muted">Every analysis gives you</p>
              <ul className="mt-4 flex flex-col divide-y divide-line">
                {COVERS.map(({ icon, title }) => (
                  <li key={title} className="flex items-center gap-3 py-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-hover text-primary-text">{icon}</span>
                    <span className="font-semibold text-heading">{title}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <Section id="how" title="How it works" intro="Three steps, a few minutes, nothing to install." tone="gray">
          <ol className="grid gap-8 md:grid-cols-3">
            <Step icon={<UserRoundPlus className="size-8" aria-hidden="true" />} n={1} title="Create your free account">
              With your email address or your Google account.
            </Step>
            <Step icon={<FileUp className="size-8" aria-hidden="true" />} n={2} title="Upload your resume">
              A PDF or Word (.docx) file. We take it from there.
            </Step>
            <Step icon={<FileSearch className="size-8" aria-hidden="true" />} n={3} title="Get your analysis">
              Read it on screen, save it as a PDF, and come back to it any time.
            </Step>
          </ol>
        </Section>

        <Section id="what" title="What your analysis covers" intro="Plain words about your own resume, never a generic checklist.">
          <ul className="grid gap-8 md:grid-cols-2">
            {COVERS.map(({ icon, title, text }) => (
              <Feature key={title} icon={icon} title={title}>
                {text}
              </Feature>
            ))}
          </ul>
        </Section>

        {/* Auto-apply is in pilot: said as it is, with what it needs, so nobody signs up expecting more (the owner's decision, 11 November 2026). */}
        <Section
          id="auto-apply"
          title="Auto-apply, in pilot"
          intro="Pathfinder can also apply for you: to jobs that fit your profile, from your own browser, within the limits you set."
          tone="gray"
        >
          <ul className="grid gap-8 md:grid-cols-3">
            <Feature icon={<Target className="size-6" aria-hidden="true" />} title="Jobs that fit you">
              Pathfinder reads companies&apos; own job boards, scores each job against your profile, and tailors your resume and cover letter
              for the good matches. It never makes up experience.
            </Feature>
            <Feature icon={<MousePointerClick className="size-6" aria-hidden="true" />} title="From your own Chrome">
              The Pathfinder extension fills in each application in your browser. It starts as a dry run, so you can check the forms before
              anything is sent, and it stops for anything only you can do.
            </Feature>
            <Feature icon={<SlidersHorizontal className="size-6" aria-hidden="true" />} title="You stay in charge">
              You choose the roles, the cities and how many applications a day. Pause it, or switch it off, at any time.
            </Feature>
          </ul>
          <p className="mx-auto max-w-3xl text-center text-muted">
            Auto-apply is in pilot. It needs the Pathfinder extension for Chrome on a computer, which isn&apos;t in the Chrome Web Store yet, and
            it works with a limited set of companies&apos; job boards. Once you&apos;ve signed in, you&apos;ll find it under Auto-apply.
          </p>
        </Section>

        <Section id="plans" title="Plans" intro="Free to start, with no card required. Paid plans give you more each day, for a week, a month or three, and don't renew on their own." tone="gray">
          <ul aria-label="Plans" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[priced.FREE, priced.WEEKLY, priced.MONTHLY, priced.QUARTERLY].map((plan) => {
              const free = plan.id === "FREE";
              const buyable = (canBuy as readonly string[]).includes(plan.id);
              const analyses = plan.analysesPerDay ?? perDay;
              return (
                <li key={plan.id} className={cn("flex flex-col gap-5 rounded-panel p-6 shadow-page", plan.id === "MONTHLY" ? "on-navy" : "border border-line bg-white")}>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-xl">{plan.name}</h3>
                    <p className={cn("text-2xl font-semibold", plan.id === "MONTHLY" ? "text-white" : "text-ink")}>{free ? "₹0" : priceText(plan)}</p>
                    <p className={cn("text-sm", plan.id === "MONTHLY" ? "text-on-brand-muted" : "text-muted")}>{plan.summary}</p>
                  </div>
                  <ul className="flex flex-col gap-3 text-sm">
                    {[
                      analyses ? `${analyses} resume ${analyses === 1 ? "analysis" : "analyses"} a day` : "Resume analyses every day",
                      `Up to ${plan.applicationsPerDay} auto-applications a day`,
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-check" aria-hidden="true" />
                        <span className={plan.id === "MONTHLY" ? "text-on-brand-muted" : "text-muted"}>{item}</span>
                      </li>
                    ))}
                  </ul>
                  {free ? (
                    <Link href={start.href} className={buttonClassName("secondary", "md", "mt-auto w-full")}>
                      {start.label}
                    </Link>
                  ) : buyable ? (
                    <Link href={signedIn ? "/settings?section=plan" : start.href} className={buttonClassName(plan.id === "MONTHLY" ? "secondary" : "primary", "md", "mt-auto w-full")}>
                      Choose {plan.name}
                    </Link>
                  ) : (
                    <p className={cn("mt-auto text-sm", plan.id === "MONTHLY" ? "text-on-brand-muted" : "text-muted")}>Paying online opens soon.</p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-10 flex flex-col gap-4">
            <h3 className="text-lg font-semibold">Every plan includes</h3>
            <ul className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                "A resume analysis with what to fix, and a free ATS check",
                "Jobs matched to your profile, from company career pages",
                "A tailored resume and cover letter for each job",
                "Auto-apply from your own Chrome, starting as a dry run",
                "Recruiter emails drafted by AI, sent from your Gmail only when you approve",
                "Your applications, replies and interviews in one place",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-check" aria-hidden="true" />
                  <span className="text-muted">{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">Prices are in Indian rupees for the whole period. When a paid plan ends you go back to Free; nothing is charged again.</p>
          </div>
        </Section>

        <Section id="privacy" title="Your resume stays private" intro="Your resume is personal. We treat it that way.">
          <ul className="grid gap-8 md:grid-cols-3">
            <Feature icon={<Lock className="size-6" aria-hidden="true" />} title="Only you can see it">
              Your resume and analyses are tied to your account. Other users can&apos;t open them.
            </Feature>
            <Feature icon={<ShieldCheck className="size-6" aria-hidden="true" />} title="Never sold">
              We use your resume only to help you: to analyse it and, if you switch auto-apply on, to apply for jobs for you. We never
              sell it.
            </Feature>
            <Feature icon={<Trash2 className="size-6" aria-hidden="true" />} title="Delete it any time">
              Remove an analysis, or everything we hold about you, from Settings.
            </Feature>
          </ul>
          <p className="text-center text-muted">
            The details are in our{" "}
            <Link href="/privacy" className="font-medium text-primary-text underline-offset-2 hover:underline">
              privacy notice
            </Link>
            .
          </p>
        </Section>

        <Section id="faq" title="Questions" intro="What students ask before they start." tone="gray">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {FAQ.map((entry) => (
              <details key={entry.q} className="group rounded-panel border border-line bg-white px-6 py-4 shadow-control">
                <summary className="cursor-pointer list-none text-lg font-semibold marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {entry.q}
                    <span aria-hidden="true" className="text-muted group-open:rotate-45 motion-safe:transition-transform">
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 text-muted">{entry.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="on-navy px-4 py-16 text-center">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-4">
            <h2 className="text-2xl md:text-3xl">Ready to see your resume the way an employer will?</h2>
            <p className="text-on-brand-muted">Create your free account and get your first analysis in a few minutes.</p>
            <Link href={start.href} className={cn(onNavyPrimary, "mt-4")}>
              {start.label}
            </Link>
          </div>
        </section>
      </main>

      <footer className="bg-white py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-1 px-4 text-center text-sm text-muted">
          <p>Pathfinder · Resume analysis for students and graduates</p>
          <Link href="/privacy" className="text-muted hover:underline">
            Privacy notice
          </Link>
        </div>
      </footer>
    </div>
  );
}


const COVERS = [
  { icon: <Sparkles className="size-6" aria-hidden="true" />, title: "An overview", text: "How your resume comes across, in plain words." },
  {
    icon: <ListChecks className="size-6" aria-hidden="true" />,
    title: "Strengths and what to improve",
    text: "What works, quoted from your own resume, and concrete changes to make.",
  },
  {
    icon: <FileSearch className="size-6" aria-hidden="true" />,
    title: "What's missing",
    text: "Details employers look for that your resume doesn't have yet, such as dates or contact details.",
  },
  {
    icon: <FileUp className="size-6" aria-hidden="true" />,
    title: "What we found",
    text: "Your skills, experience and education as we read them, so you can check nothing got lost.",
  },
];

/** The homepage's questions (Phase 5): only what the product does today, in plain words. */
const FAQ: { q: string; a: string }[] = [
  {
    q: "What does Pathfinder do?",
    a: "It reads your resume and tells you what works and what to improve. If you want, it also finds jobs that fit you, tailors your resume and cover letter to each one, and applies for you from your own browser.",
  },
  {
    q: "Is it free?",
    a: "Yes, the Free plan is free and needs no card: resume analyses every day, and auto-apply up to 10 applications a day. Paid plans give you more analyses and applications a day for a week, a month or three months; they don't renew on their own, and the free plan stays free.",
  },
  {
    q: "How does auto-apply work?",
    a: "You tell it the roles and cities you want and answer the questions most forms ask, once. It picks your strongest matches from companies' own job boards, prepares a tailored resume for each, and the Pathfinder extension fills the form in your Chrome. It starts in dry run: it fills forms but stops before Submit until you switch that off.",
  },
  {
    q: "Will it apply to jobs I don't want?",
    a: "Only to your strong matches, within the limits you set per day and per company. You can skip companies, pause it from the extension or switch it off at any time, and every application shows on your dashboard.",
  },
  {
    q: "Does it make up answers or experience?",
    a: "No. It uses only your profile and the answers you gave. A question it can't answer from them comes back to you, and it never invents experience, skills or numbers.",
  },
  {
    q: "Which job sites does it work with?",
    a: "Companies' own career pages on Greenhouse, Lever, Ashby and SmartRecruiters. It doesn't automate LinkedIn, Naukri or Indeed, whose terms forbid it, so your accounts there are never at risk.",
  },
  {
    q: "What if a form asks for a captcha, a code or a sign-in?",
    a: "It never gets round those. It leaves the form open in Chrome for you to finish, and tells you on your dashboard.",
  },
  {
    q: "Do I need to install anything?",
    a: "Not for the resume analysis. For auto-apply you add the Pathfinder extension to Chrome, which submits applications from your own browser rather than from our servers.",
  },
  {
    q: "Is my resume safe?",
    a: "Your resume and analyses are private to your account and never sold. You can delete one analysis, or everything we hold about you, from Settings at any time.",
  },
];

function Section({
  id,
  title,
  intro,
  tone = "white",
  children,
}: {
  id: string;
  title: string;
  intro: string;
  tone?: "white" | "gray";
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-16 px-4 py-20", tone === "gray" ? "bg-surface" : "bg-white")}>
      <div className="mx-auto flex max-w-7xl flex-col gap-12">
        <div className="text-center">
          <h2 id={`${id}-title`} className="text-3xl md:text-4xl">
            {title}
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-xl text-muted">{intro}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

/** The reference's step card: an icon in a blue circle, centred text and a blue bar at the foot. */
function Step({ icon, n, title, children }: { icon: ReactNode; n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex h-full flex-col items-center rounded-panel bg-white p-8 text-center shadow-control motion-safe:transition-shadow hover:shadow-toolbar">
      <span className="mb-6 grid size-16 place-items-center rounded-full bg-hover text-primary-text">{icon}</span>
      <span className="text-sm font-medium text-muted">Step {n}</span>
      <h3 className="mt-1 mb-4 text-xl font-semibold">{title}</h3>
      <p className="flex-grow text-muted">{children}</p>
      <span aria-hidden="true" className="mt-6 h-1 w-full rounded-full bg-primary" />
    </li>
  );
}

/** The reference's feature card: a white card with a blue icon, a bold title and gray text. */
function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="rounded-panel bg-white p-8 shadow-page motion-safe:transition-shadow hover:shadow-dialog">
      <span className="mb-6 block text-primary-text">{icon}</span>
      <h3 className="mb-4 text-xl">{title}</h3>
      <p className="text-muted">{children}</p>
    </li>
  );
}

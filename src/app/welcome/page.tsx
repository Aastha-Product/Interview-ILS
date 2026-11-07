import { FileSearch, FileUp, ListChecks, Lock, ShieldCheck, Sparkles, Trash2, UserRoundPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { buttonClassName } from "@/components/ui/button";
import { analysesPerDay } from "@/lib/ai/daily-limit";
import { signInMode } from "@/lib/auth/google-sign-in";
import { HOME_PATH } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Resume analysis for students and graduates",
  description: "Upload your resume and get a clear analysis: what works, what to improve and what's missing. Free to start.",
};

/**
 * The public homepage (Pathfinder), shown at / to visitors who aren't signed in: what the service
 * does, how it works, the plans, and how resumes are kept private.
 */
export default async function WelcomePage() {
  const signedIn = (await getSession()) !== null;
  const canSignUp = signInMode() === "firebase";
  const perDay = analysesPerDay();
  const start = signedIn
    ? { href: HOME_PATH, label: "Go to your dashboard" }
    : { href: canSignUp ? "/signup" : "/login", label: "Get started free" };

  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="mx-auto flex max-w-[1080px] items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-ink hover:text-ink">
          <BrandMark className="size-8" />
          <span className="font-serif text-[22px] font-medium tracking-[-0.01em]">Dossier</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-3">
          <a href="#plans" className="hidden px-2 text-sm text-muted hover:text-ink sm:inline">
            Plans
          </a>
          <a href="#privacy" className="hidden px-2 text-sm text-muted hover:text-ink sm:inline">
            Privacy
          </a>
          {!signedIn && (
            <Link href="/login" className={buttonClassName("text", "md", "px-2!")}>
              Sign in
            </Link>
          )}
          <Link href={start.href} className={buttonClassName("primary", "md")}>
            {signedIn ? "Dashboard" : "Get started"}
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto flex max-w-[1080px] flex-col items-start gap-6 px-4 pt-12 pb-16 sm:px-8 sm:pt-20">
          <p className="rounded-full border border-line bg-card px-3 py-1 text-meta text-muted">For students and graduates</p>
          <h1 className="max-w-[760px] font-serif text-[40px] leading-[1.08] tracking-[-0.02em] text-balance sm:text-[56px]">
            See your resume the way an employer will
          </h1>
          <p className="max-w-[620px] text-lg text-pretty text-muted">
            Upload your resume and get a clear analysis: what works, what to improve, and what&apos;s missing. No setup, nothing to
            install. Free to start.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={start.href} className={buttonClassName("primary", "lg")}>
              {start.label}
            </Link>
            {!signedIn && (
              <Link href="/login" className={buttonClassName("secondary", "lg")}>
                Sign in
              </Link>
            )}
          </div>
        </section>

        <Section id="how" title="How it works">
          <ol className="grid gap-4 sm:grid-cols-3">
            <Step icon={<UserRoundPlus size={20} aria-hidden="true" />} n={1} title="Create your free account">
              With your email address or your Google account.
            </Step>
            <Step icon={<FileUp size={20} aria-hidden="true" />} n={2} title="Upload your resume">
              A PDF or Word (.docx) file. We take it from there.
            </Step>
            <Step icon={<FileSearch size={20} aria-hidden="true" />} n={3} title="Get your analysis">
              Read it on screen, save it as a PDF, and come back to it any time.
            </Step>
          </ol>
        </Section>

        <Section id="what" title="What your analysis covers">
          <ul className="grid gap-4 sm:grid-cols-2">
            <Feature icon={<Sparkles size={18} aria-hidden="true" />} title="An overview">
              How your resume comes across, in plain words.
            </Feature>
            <Feature icon={<ListChecks size={18} aria-hidden="true" />} title="Strengths and what to improve">
              What works, quoted from your own resume, and concrete changes to make.
            </Feature>
            <Feature icon={<FileSearch size={18} aria-hidden="true" />} title="What's missing">
              Details employers look for that your resume doesn&apos;t have yet, such as dates or contact details.
            </Feature>
            <Feature icon={<FileUp size={18} aria-hidden="true" />} title="What we found">
              Your skills, experience and education as we read them, so you can check nothing got lost.
            </Feature>
          </ul>
        </Section>

        <Section id="plans" title="Plans">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-card border border-line-card bg-card p-6">
              <h3 className="font-serif text-section">Free</h3>
              <p className="text-sm text-muted">Everything you need to try it, with no card required.</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                <li>{perDay ? `${perDay} resume ${perDay === 1 ? "analysis" : "analyses"} a day` : "Resume analyses at no cost"}</li>
                <li>Your past analyses, kept for you</li>
                <li>Save any analysis as a PDF</li>
              </ul>
              <Link href={start.href} className={buttonClassName("primary", "md", "mt-auto self-start")}>
                {start.label}
              </Link>
            </div>
            <div className="flex flex-col gap-3 rounded-card border border-dashed border-line p-6">
              <h3 className="font-serif text-section">Paid plans</h3>
              <p className="text-sm text-muted">Coming soon: more analyses and extra tools. The free plan stays free.</p>
            </div>
          </div>
        </Section>

        <Section id="privacy" title="Your resume stays private">
          <ul className="grid gap-4 sm:grid-cols-3">
            <Feature icon={<Lock size={18} aria-hidden="true" />} title="Only you can see it">
              Your resume and analyses are tied to your account. Other users can&apos;t open them.
            </Feature>
            <Feature icon={<ShieldCheck size={18} aria-hidden="true" />} title="Never sold">
              We use your resume only to analyse it for you, and never sell it.
            </Feature>
            <Feature icon={<Trash2 size={18} aria-hidden="true" />} title="Delete it any time">
              Remove an analysis, or everything we hold about you, from Settings.
            </Feature>
          </ul>
          <p className="text-sm text-muted">
            The details are in our{" "}
            <Link href="/privacy" className="font-medium text-ink underline underline-offset-2">
              privacy notice
            </Link>
            .
          </p>
        </Section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-meta text-muted sm:px-8">
          <span>Dossier · Resume analysis for students and graduates</span>
          <Link href="/privacy" className="hover:text-ink">
            Privacy notice
          </Link>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto flex max-w-[1080px] scroll-mt-6 flex-col gap-6 px-4 py-10 sm:px-8">
      <h2 id={`${id}-title`} className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Step({ icon, n, title, children }: { icon: ReactNode; n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line-card bg-card p-5">
      <span className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-meta">Step {n}</span>
      </span>
      <span className="text-field font-medium">{title}</span>
      <span className="text-sm text-muted">{children}</span>
    </li>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control bg-hover text-ink">{icon}</span>
      <span className="flex flex-col gap-1">
        <span className="text-field font-medium">{title}</span>
        <span className="text-sm text-muted">{children}</span>
      </span>
    </li>
  );
}

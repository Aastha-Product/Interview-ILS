"use client";

import Link from "next/link";
import { useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { buttonClassName } from "@/components/ui/button";
import { ATS_MIN_WORDS, checkResume, type AtsResult, type AtsStatus } from "@/lib/ats-check";
import { HOME_PATH } from "@/lib/auth/next-path";
import { cn } from "@/lib/cn";
import { readResumeFile } from "@/lib/resume-text-browser";

const STATUS: Record<AtsStatus, { label: string; className: string }> = {
  pass: { label: "Good", className: "border border-success text-success" },
  improve: { label: "Could be better", className: "bg-warning-surface text-warning" },
  fix: { label: "Fix this", className: "bg-danger-surface text-error-strong" },
};

/**
 * The ATS checker (Phase 5), laid out like the public homepage. A resume, as a file or pasted
 * text, and optionally a job description; the result comes back at once, checked in the browser.
 */
export function AtsCheckerScreen({ signedIn, canSignUp }: { signedIn: boolean; canSignUp: boolean }) {
  const [resume, setResume] = useState("");
  const [job, setJob] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<AtsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = signedIn ? { href: HOME_PATH, label: "Analyse it in Pathfinder" } : { href: canSignUp ? "/signup" : "/login", label: "Sign up free" };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const read = await readResumeFile(file);
      if (read.ok) {
        setResume(read.text);
        setFileNote(`Read from ${file.name}. Check the text below if anything looks off.`);
      } else {
        setFileNote(null);
        setError(read.error);
      }
    } finally {
      setReading(false);
    }
  };

  const run = () => {
    const words = resume.trim().split(/\s+/).filter(Boolean).length;
    if (words < ATS_MIN_WORDS) {
      setError("Add your whole resume first: choose the file, or paste its text.");
      setResult(null);
      return;
    }
    setError(null);
    setResult(checkResume(resume, job));
  };

  return (
    <div className="flex min-h-screen flex-col bg-white pt-16 text-ink light-page">
      <header className="on-navy fixed top-0 z-50 w-full">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 text-white hover:text-white">
            <BrandMark className="size-8" />
            <span className="text-xl font-bold">Pathfinder</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/open-jobs" className="hidden rounded-md px-3 py-2 text-on-brand-muted hover:text-white sm:inline">
              Open jobs
            </Link>
            {!signedIn && (
              <Link href="/login" className={buttonClassName("secondary", "md", "px-3 sm:px-5")}>
                Sign in
              </Link>
            )}
            <Link href={signedIn ? HOME_PATH : start.href} className={buttonClassName("primary", "md", "px-3 sm:px-5")}>
              {signedIn ? "Dashboard" : "Get started"}
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="bg-brand-gradient px-4 pt-12 pb-10">
          <div className="mx-auto flex max-w-4xl flex-col gap-3">
            <h1 className="text-3xl leading-tight font-bold text-balance text-white md:text-4xl">Free ATS resume checker</h1>
            <p className="max-w-2xl text-on-brand-muted">
              See how an applicant tracking system reads your resume, and how well it fits a job. Free and no sign-up: the check runs in your browser and your resume
              never leaves your device.
            </p>
          </div>
        </section>

        <section className="px-4 py-8">
          <div className="mx-auto flex max-w-4xl flex-col gap-6">
            <form
              aria-label="Check a resume"
              className="flex flex-col gap-4 rounded-card border border-line-card p-5"
              onSubmit={(event) => {
                event.preventDefault();
                run();
              }}
            >
              <label className="flex flex-col gap-1 text-sm font-medium">
                Your resume (PDF, .docx or text)
                <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => void choose(event.target.files?.[0])} className="text-sm font-normal" />
              </label>
              {reading ? <p className="text-meta text-muted">Reading the file…</p> : fileNote ? <p className="text-meta text-muted">{fileNote}</p> : null}
              <label className="flex flex-col gap-1 text-sm font-medium">
                Or paste its text
                <textarea value={resume} onChange={(event) => setResume(event.target.value)} rows={10} maxLength={30_000} className="rounded-control border border-line-field p-3 font-normal" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Job description <span className="font-normal text-muted">(optional: to check the job&apos;s keywords)</span>
                <textarea value={job} onChange={(event) => setJob(event.target.value)} rows={5} maxLength={20_000} className="rounded-control border border-line-field p-3 font-normal" />
              </label>
              {error ? (
                <p role="alert" className="text-sm text-error-strong">
                  {error}
                </p>
              ) : null}
              <div>
                <button type="submit" className={buttonClassName("primary", "md")} aria-disabled={reading || undefined}>
                  Check my resume
                </button>
              </div>
            </form>

            {result ? (
              <section aria-labelledby="ats-result" className="flex flex-col gap-4">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 id="ats-result" className="text-2xl font-bold">
                    <span className="tabular-nums">{result.score}</span>/100 · {result.label}
                  </h2>
                  <span className="text-sm text-muted">About {result.words} words checked.</span>
                </div>
                <ul aria-label="Checks" className="flex flex-col divide-y divide-line rounded-card border border-line-card">
                  {result.checks.map((check) => (
                    <li key={check.id} className="flex flex-col gap-1 px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold">{check.title}</h3>
                        <span className={cn("rounded-full px-2.5 py-0.5 text-meta", STATUS[check.status].className)}>
                          {STATUS[check.status].label} · {check.points}/{check.max}
                        </span>
                      </div>
                      <p className="text-sm text-muted">{check.detail}</p>
                      {check.tip ? <p className="text-sm">{check.tip}</p> : null}
                    </li>
                  ))}
                </ul>
                {result.keywords && result.keywords.missing.length > 0 ? (
                  <p className="text-sm">
                    <span className="font-semibold">Keywords from the job not in your resume:</span> {result.keywords.missing.join(", ")}. Add the ones that are true for you.
                  </p>
                ) : null}
                <p className="text-meta text-muted">
                  A guide to what to fix, from plain rules: real tracking systems differ, and a recruiter reads it too.
                </p>
                <aside className="flex flex-col gap-3 rounded-card border border-line-card bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm">
                    <span className="font-semibold">Want a full analysis and a resume tailored to each job?</span> Pathfinder reads your resume, says what to improve, and can apply for you.
                  </p>
                  <Link href={start.href} className={buttonClassName("primary", "md", "shrink-0")}>
                    {start.label}
                  </Link>
                </aside>
              </section>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="bg-white py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-1 px-4 text-center text-sm text-muted">
          <p>Pathfinder · Your resume is checked in your browser and isn&apos;t sent or stored.</p>
          <Link href="/privacy" className="text-muted hover:underline">
            Privacy notice
          </Link>
        </div>
      </footer>
    </div>
  );
}

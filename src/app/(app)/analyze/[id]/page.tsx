import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDateRange } from "@/lib/profile";
import { getResumeAnalysis } from "@/lib/resume-analysis";

import { DeleteAnalysisButton } from "./delete-button";
import { ImportIntoProfileButton } from "./import-button";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Your resume analysis" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4 px-6 py-7 sm:px-8 print:border-0 print:p-0">
      <h2 className="font-serif text-section">{title}</h2>
      {children}
    </Card>
  );
}

/** Pathfinder: the results of one analysis, in plain language, with what was read from the resume. */
export default async function AnalysisPage({ params }: PageProps<"/analyze/[id]">) {
  const { id } = await params;
  const analysis = await getResumeAnalysis(id);
  if (!analysis) notFound();
  const { review, profile } = analysis;

  return (
    <>
      <PageHeader
        title="Your resume analysis"
        description={`${analysis.fileName || "Your resume"} · ${dateFormat.format(analysis.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <DeleteAnalysisButton id={analysis.id} />
            <PrintButton />
            <Link href="/analyze" className={buttonClassName("primary")}>
              Analyse another
            </Link>
          </div>
        }
      />
      <div className="flex max-w-[960px] flex-col gap-6 px-4 pb-20 sm:px-10">
        <Section title="Overview">
          <p className="text-lead text-pretty text-ink">{review.overview}</p>
        </Section>

        <div className="grid gap-6 md:grid-cols-2">
          <Section title="What works well">
            {review.strengths.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {review.strengths.map((item) => (
                  <li key={item.point} className="flex flex-col gap-1">
                    <span className="text-field text-ink">{item.point}</span>
                    <span className="text-meta text-muted italic">“{item.quote}”</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-field text-muted">Nothing we could point to with confidence. The suggestions next to this are a good place to start.</p>
            )}
          </Section>

          <Section title="What to improve">
            {review.improvements.length > 0 ? (
              <ol className="flex flex-col gap-4">
                {review.improvements.map((item, index) => (
                  <li key={item.point} className="flex gap-3">
                    <span aria-hidden="true" className="font-serif text-field text-muted">
                      {index + 1}.
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-field font-medium text-ink">{item.point}</span>
                      <span className="text-field text-ink">{item.suggestion}</span>
                      {item.quote && <span className="text-meta text-muted italic">About: “{item.quote}”</span>}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-field text-muted">No changes to suggest.</p>
            )}
          </Section>
        </div>

        <Section title="Missing or unclear">
          {review.missing.length > 0 ? (
            <ul className="flex list-disc flex-col gap-2 pl-5 text-field text-ink">
              {review.missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-field text-muted">Nothing obvious is missing.</p>
          )}
        </Section>

        <Section title="What we found in your resume">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h3 className="text-field font-medium text-ink">Skills</h3>
              {profile.skills.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {profile.skills.map((skill) => (
                    <li key={skill.name} className="rounded-full border border-line-field bg-input px-3 py-1 text-meta text-ink">
                      {skill.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-meta text-muted">None listed.</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-field font-medium text-ink">Experience</h3>
              {profile.experience.length + profile.projects.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {profile.experience.map((role, index) => (
                    <li key={`role-${index}`} className="flex flex-wrap justify-between gap-x-4 text-field text-ink">
                      <span>
                        {role.role}
                        {role.company && <span className="text-muted"> · {role.company}</span>}
                      </span>
                      <span className="text-meta text-muted">{formatDateRange(role)}</span>
                    </li>
                  ))}
                  {profile.projects.map((project, index) => (
                    <li key={`project-${index}`} className="flex flex-wrap justify-between gap-x-4 text-field text-ink">
                      <span>
                        {project.name} <span className="text-muted">· Project</span>
                      </span>
                      <span className="text-meta text-muted">{formatDateRange(project)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-meta text-muted">None found.</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-field font-medium text-ink">Education</h3>
              {profile.education.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {profile.education.map((entry, index) => (
                    <li key={index} className="flex flex-wrap justify-between gap-x-4 text-field text-ink">
                      <span>
                        {entry.degree}
                        {entry.school && <span className="text-muted"> · {entry.school}</span>}
                      </span>
                      <span className="text-meta text-muted">{formatDateRange(entry)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-meta text-muted">None found.</p>
              )}
            </div>
          </div>
        </Section>

        <Card className="flex flex-col gap-3 px-6 py-6 sm:px-8 print:hidden">
          <h2 className="font-serif text-section">Next steps</h2>
          <p className="text-field text-ink">
            {analysis.profileFilled
              ? "We used this resume to fill in your profile, so you can tailor it to a job straight away."
              : "Your profile already has details, so we didn't change it. You can add what this resume found to it in one step, or edit your profile by hand."}
          </p>
          <div className="flex flex-wrap gap-3">
            {!analysis.profileFilled && <ImportIntoProfileButton id={analysis.id} />}
            <Link href="/new?fresh=1" className={buttonClassName("secondary")}>
              Tailor it to a job
            </Link>
            <Link href="/profile" className={buttonClassName("secondary")}>
              Edit my profile
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}

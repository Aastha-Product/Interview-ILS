"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AiProvider } from "@/generated/prisma/enums";
import { useJob } from "@/hooks/use-job";
import { providerOption } from "@/lib/ai/provider-options";
import { retry } from "@/lib/jobs/actions";
import type { ImportProfileResult } from "@/lib/jobs/import-profile";
import { messages } from "@/lib/messages";
import { citationText } from "@/lib/citation";
import { BASICS_FIELDS, formatDateRange, languageLevelLabel, type BasicsField } from "@/lib/profile";
import { IMPORT_PROFILE_STEPS, importCounts, type ImportedProfile, type ImportMode } from "@/lib/profile-import";

import { JobProgress, jobStep } from "../../new/job-progress";
import { applyProfileImport, discardProfileImport } from "../actions";

const BASICS_LABELS: Record<BasicsField, string> = {
  name: "Full name",
  headline: "Headline",
  email: "Email",
  phone: "Phone",
  dob: "Date of birth",
  website: "Website",
  address: "Street address",
  city: "City",
  country: "Country",
  linkedin: "LinkedIn",
  summary: "About you",
};

/**
 * Import a profile from a resume file (E4-10): choose a PDF, Word or Markdown file, wait
 * while the AI sorts its text, then look at everything it found and merge it
 * into the profile or replace the profile with it. Nothing goes into the
 * profile before; the reading is deleted once it's used or set aside.
 */
export function ProfileImport({
  aiReady,
  provider,
  initialJobId,
  keptFor,
  managed = false,
}: {
  aiReady: boolean;
  provider: AiProvider;
  initialJobId: string | null;
  /** How long an unused reading is kept (Settings → Your data), e.g. "24 hours". */
  keptFor: string;
  /** Pathfinder: the service runs the AI (PATHFINDER_MANAGED), so no "choose a provider". */
  managed?: boolean;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJobId);
  const [revision, setRevision] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  // Pathfinder (Phase C): the student's edits to the preview; null until they change something, so an
  // untouched import behaves exactly as before (the server uses the reading from the job).
  const [edited, setEdited] = useState<ImportedProfile | null>(null);
  const job = useJob<ImportProfileResult>(jobId, revision);
  const fileId = useId();

  const phase = !jobId ? "choose" : job?.status === "DONE" && job.result ? "preview" : "reading";
  const current = edited ?? (phase === "preview" && job?.result ? job.result.profile : null);

  const setBasic = (field: BasicsField, value: string) => {
    if (current) setEdited({ ...current, basics: { ...current.basics, [field]: value } });
  };
  const removeAt = <K extends "skills" | "languages" | "experience" | "projects" | "education" | "publications" | "references">(key: K, index: number) => {
    if (current) setEdited({ ...current, [key]: current[key].filter((_, i) => i !== index) });
  };

  // E11-3: each phase replaces the last one's controls, so focus goes to its heading.
  const area = useRef<HTMLDivElement>(null);
  const shownPhase = useRef(phase);
  useEffect(() => {
    if (shownPhase.current === phase) return;
    shownPhase.current = phase;
    area.current?.querySelector<HTMLElement>("h2[tabindex], input[type=file]")?.focus();
  }, [phase]);

  const follow = (id: string | null) => {
    setJobId(id);
    setEdited(null);
    router.replace(id ? `/profile/import?job=${id}` : "/profile/import");
  };

  // "Choose another file": the reading goes, with the resume's text.
  const startOver = () => {
    if (jobId) void discardProfileImport({ jobId });
    follow(null);
  };

  async function read() {
    if (!file) return toast("Choose your resume file first.");
    setUploading(true);
    try {
      const response = await fetch("/api/profile/import", {
        method: "POST",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      });
      const body = (await response.json().catch(() => null)) as { jobId?: string; error?: string } | null;
      if (!response.ok || !body?.jobId) return toast(body?.error ?? messages.unexpected);
      follow(body.jobId);
    } catch {
      toast(messages.offline);
    } finally {
      setUploading(false);
    }
  }

  async function apply(mode: ImportMode) {
    if (!jobId) return;
    setApplying(true);
    // Only send the edited profile when the student actually changed something.
    const result = toastResult(await applyProfileImport({ jobId, mode, edited: edited ?? undefined }));
    setApplying(false);
    if (result.ok) router.push("/profile");
  }

  return (
    <>
      <PageHeader
        title="Import from a resume"
        description={`Start your profile from a resume you already have. Nothing goes into your profile until you've seen what was found. The file's text is deleted once you've chosen, or after ${keptFor} if you don't.`}
        actions={
          <Link href="/profile" className={buttonClassName("secondary")}>
            Back to your profile
          </Link>
        }
      />
      <div ref={area} className="flex max-w-[816px] flex-col gap-6 px-10 pb-20">
        {phase === "choose" && (
          <Card className="flex flex-col items-start gap-5">
            {!aiReady &&
              (managed ? (
                // Pathfinder, managed mode: the service runs the AI; there's nothing for the student to set up.
                <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                  Reading resumes isn&apos;t available right now. Please try again in a few minutes.
                </p>
              ) : (
                <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                  No AI provider is set up yet, so nothing can read the resume.{" "}
                  <Link href="/settings?section=ai" className="font-medium text-warning underline underline-offset-2">
                    Choose one in Settings → AI provider
                  </Link>
                </p>
              ))}
            {aiReady && !providerOption(provider).local && (
              <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                The resume&apos;s text, contact details included, is sent to {providerOption(provider).vendor ?? "your AI server"} to sort
                it into your profile.
              </p>
            )}
            <div className="flex flex-col gap-2">
              <label htmlFor={fileId} className="text-label text-muted">
                Your resume, as PDF, Word (.docx) or Markdown (.md)
              </label>
              <input
                id={fileId}
                type="file"
                accept=".pdf,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="text-sm file:mr-3 file:rounded-control file:border file:border-line-control file:bg-input file:px-3 file:py-2 file:text-sm file:text-ink hover:file:border-line-strong"
              />
            </div>
            <Button aria-disabled={!aiReady || !file || uploading || undefined} onClick={() => void (aiReady && !uploading ? read() : undefined)}>
              {uploading ? "Sending…" : "Read my resume →"}
            </Button>
          </Card>
        )}

        {phase === "reading" && (
          <JobProgress
            title="Reading your resume…"
            steps={IMPORT_PROFILE_STEPS}
            current={jobStep(IMPORT_PROFILE_STEPS, job)}
            error={job?.status === "FAILED" ? job.error : null}
            onRetry={() => void retry({ id: jobId! }).then((result) => toastResult(result).ok && setRevision((count) => count + 1))}
            onBack={startOver}
            backLabel="← Choose another file"
          />
        )}

        {phase === "preview" && current && (
          <>
            <Preview profile={current} onBasic={setBasic} onRemove={removeAt} />
            <Card className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                Fix anything above, or remove what you don&apos;t want, before you add it.{" "}
                <strong className="font-medium text-ink">Merge</strong> adds all this to your profile; where your profile already has the same
                detail, role, degree or reference, what the resume says wins. <strong className="font-medium text-ink">Replace</strong> clears your
                profile first.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button aria-disabled={applying || undefined} onClick={() => void (applying ? undefined : apply("merge"))}>
                  Merge into my profile
                </Button>
                <Button variant="secondary" aria-disabled={applying || undefined} onClick={() => setConfirmReplace(true)}>
                  Replace my profile…
                </Button>
                <Button variant="text" onClick={startOver}>
                  Choose another file
                </Button>
              </div>
            </Card>
            <ConfirmDialog
              open={confirmReplace}
              onOpenChange={setConfirmReplace}
              title="Replace your profile?"
              description="Your basics, skills, languages, roles, projects, education, publications and references are removed first; then your profile holds exactly what was read from the resume. Your applications and their documents stay as they are."
              confirmLabel="Replace my profile"
              onConfirm={() => void apply("replace")}
            />
          </>
        )}
      </div>
    </>
  );
}

/**
 * Everything read from the resume, editable before it's added (Pathfinder, Phase C): the basics can be
 * fixed or filled in, and any item removed. What couldn't be found in the file word for word is marked.
 */
function Preview({
  profile,
  onBasic,
  onRemove,
}: {
  profile: ImportedProfile;
  onBasic: (field: BasicsField, value: string) => void;
  onRemove: (key: "skills" | "languages" | "experience" | "projects" | "education" | "publications" | "references", index: number) => void;
}) {
  const ids = useId();
  return (
    <Card className="flex flex-col gap-7">
      <div className="flex flex-col gap-1">
        {/* Takes focus when the preview appears (E11-3). */}
        <h2 tabIndex={-1} className="font-serif text-section">
          Here&apos;s what your resume says
        </h2>
        <p className="text-meta text-muted">
          {importCounts(profile)}. Fix anything that&apos;s wrong, fill in what&apos;s blank, and remove what you don&apos;t want. Anything marked
          “check” isn&apos;t in the file word for word.
        </p>
      </div>

      <Section title="Basics">
        <div className="grid gap-3 sm:grid-cols-2">
          {BASICS_FIELDS.map((field) => (
            <label key={field} htmlFor={`${ids}-${field}`} className={field === "summary" ? "flex flex-col gap-1 sm:col-span-2" : "flex flex-col gap-1"}>
              <span className="text-label text-muted">{BASICS_LABELS[field]}</span>
              {field === "summary" ? (
                <textarea
                  id={`${ids}-${field}`}
                  value={profile.basics[field] ?? ""}
                  onChange={(event) => onBasic(field, event.target.value)}
                  rows={3}
                  className="w-full rounded-control border border-line-control bg-input px-3 py-2 text-sm text-ink"
                />
              ) : (
                <input
                  id={`${ids}-${field}`}
                  value={profile.basics[field] ?? ""}
                  onChange={(event) => onBasic(field, event.target.value)}
                  className="w-full rounded-control border border-line-control bg-input px-3 py-2 text-sm text-ink"
                />
              )}
            </label>
          ))}
        </div>
      </Section>

      {profile.skills.length > 0 && (
        <Section title="Skills">
          <ul className="flex flex-wrap gap-2 text-sm">
            {profile.skills.map((skill, index) => (
              <li key={`${skill.name}-${index}`} className="flex items-center gap-1 rounded-full border border-line-field bg-input px-3 py-1">
                <span>{skill.name}</span>
                {!skill.found && (
                  <>
                    {" "}
                    <Check>not in the file</Check>
                  </>
                )}
                <RemoveButton label={`skill ${skill.name}`} onClick={() => onRemove("skills", index)} compact />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {profile.languages.length > 0 && (
        <Section title="Languages">
          <ul className="flex flex-col gap-1 text-sm">
            {profile.languages.map((language, index) => (
              <li key={`${language.name}-${index}`} className="flex items-center gap-2">
                <span>
                  {language.name}: {languageLevelLabel(language.level)}
                  {!language.levelGiven && <span className="text-muted"> (no level given; change it any time)</span>}
                </span>
                <RemoveButton label={`language ${language.name}`} onClick={() => onRemove("languages", index)} compact />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {profile.experience.length > 0 && (
        <Section title="Experience">
          {profile.experience.map((entry, index) => (
            <Entry
              key={index}
              title={[entry.role, entry.company].filter(Boolean).join(" · ")}
              meta={[entry.location, formatDateRange(entry)].filter(Boolean).join(" · ")}
              unverified={entry.unverified}
              onRemove={() => onRemove("experience", index)}
            >
              {entry.descriptor && <p className="text-muted italic">{entry.descriptor}</p>}
              {entry.bullets && (
                <ul className="list-disc pl-5">
                  {entry.bullets.split("\n").map((line, lineIndex) => (
                    <li key={lineIndex}>{line}</li>
                  ))}
                </ul>
              )}
              {entry.skills.length > 0 && <p className="text-muted">Skills: {entry.skills.join(" · ")}</p>}
            </Entry>
          ))}
        </Section>
      )}

      {profile.projects.length > 0 && (
        <Section title="Projects">
          {profile.projects.map((entry, index) => (
            <Entry
              key={index}
              title={entry.name}
              meta={[entry.link, formatDateRange(entry)].filter(Boolean).join(" · ")}
              unverified={entry.unverified}
              onRemove={() => onRemove("projects", index)}
            >
              {entry.bullets && (
                <ul className="list-disc pl-5">
                  {entry.bullets.split("\n").map((line, lineIndex) => (
                    <li key={lineIndex}>{line}</li>
                  ))}
                </ul>
              )}
              {entry.skills.length > 0 && <p className="text-muted">Skills: {entry.skills.join(" · ")}</p>}
            </Entry>
          ))}
        </Section>
      )}

      {profile.education.length > 0 && (
        <Section title="Education">
          {profile.education.map((entry, index) => (
            <Entry
              key={index}
              title={[entry.degree, entry.school].filter(Boolean).join(" · ")}
              meta={formatDateRange(entry)}
              unverified={entry.unverified}
              onRemove={() => onRemove("education", index)}
            >
              {entry.notes && <p>{entry.notes}</p>}
            </Entry>
          ))}
        </Section>
      )}

      {profile.publications.length > 0 && (
        <Section title="Publications">
          {profile.publications.map((entry, index) => (
            <Entry key={index} title={citationText(entry.citation)} meta={entry.link} unverified={entry.unverified} onRemove={() => onRemove("publications", index)} />
          ))}
        </Section>
      )}

      {profile.references.length > 0 && (
        <Section title="References">
          {profile.references.map((entry, index) => (
            <Entry
              key={index}
              title={entry.name}
              meta={[entry.relation, entry.company, entry.email, entry.phone].filter(Boolean).join(" · ")}
              unverified={entry.unverified}
              onRemove={() => onRemove("references", index)}
            />
          ))}
        </Section>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-5">
      <h3 className="text-[15px] font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Entry({ title, meta, unverified, onRemove, children }: { title: string; meta: string; unverified: string[]; onRemove?: () => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">
          {title}
          {unverified.length > 0 && (
            <>
              {" "}
              <Check>{unverified.map((word) => `“${word}”`).join(" and ")} not in the file</Check>
            </>
          )}
        </p>
        {onRemove && <RemoveButton label={title || "this entry"} onClick={onRemove} />}
      </div>
      {meta && <p className="text-meta text-muted tabular-nums">{meta}</p>}
      {children}
    </div>
  );
}

/** Takes one item out of the preview before it's added. */
function RemoveButton({ label, onClick, compact = false }: { label: string; onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${label}`}
      className={
        compact
          ? "shrink-0 leading-none text-muted hover:text-ink"
          : "shrink-0 text-meta text-muted underline underline-offset-2 hover:text-ink"
      }
    >
      {compact ? "×" : "Remove"}
    </button>
  );
}

/** "check": something the model returned that the file's text doesn't contain. */
function Check({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 rounded-full bg-warning-surface px-2 py-0.5 text-xs font-normal text-warning">
      check<span className="sr-only">: {children}</span>
    </span>
  );
}

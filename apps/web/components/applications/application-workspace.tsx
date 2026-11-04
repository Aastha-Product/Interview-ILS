"use client";

import type { AnswersContent, ApplicationView, ResumeContent, TaskStateView } from "@pathfinder/core";
import { CheckCircle2, Download, ExternalLink, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { api, ApiRequestError } from "@/lib/api";
import { formatDay, STATUS_LABELS, STATUS_STYLES, STATUSES, type Status } from "@/lib/applications";

const ACTIVE: TaskStateView[] = ["queued", "working"];

export function ApplicationWorkspace({ initial }: { initial: ApplicationView }) {
  const [view, setView] = useState(initial);
  const [resume, setResume] = useState<ResumeContent | null>(initial.resume?.content ?? null);
  const [answers, setAnswers] = useState<AnswersContent | null>(initial.answers?.content ?? null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "pdf" | "status" | "redraft">(null);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);

  const tailorTask = view.tasks.find((t) => t.kind === "tailor");
  const pdfTask = view.tasks.find((t) => t.kind === "pdf");
  const working = view.tasks.some((t) => ACTIVE.includes(t.state));

  const applyView = useCallback(
    (next: ApplicationView, force = false) => {
      setView(next);
      if (force || !dirty) {
        setResume(next.resume?.content ?? null);
        setAnswers(next.answers?.content ?? null);
        if (force) setDirty(false);
      }
    },
    [dirty],
  );

  // Poll while the worker is drafting or rendering.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(async () => {
      try {
        applyView(await api<ApplicationView>(`/api/applications/${view.id}`));
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [working, view.id, applyView]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const editResume = (fn: (r: ResumeContent) => ResumeContent) => {
    setResume((r) => (r ? fn(structuredClone(r)) : r));
    setDirty(true);
    setMessage(null);
  };
  const editAnswers = (fn: (a: AnswersContent) => AnswersContent) => {
    setAnswers((a) => (a ? fn(structuredClone(a)) : a));
    setDirty(true);
    setMessage(null);
  };

  async function run<T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>) {
    setBusy(kind);
    setMessage(null);
    try {
      return await fn();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiRequestError ? e.message : "Something went wrong. Please try again." });
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      const next = await api<ApplicationView>(`/api/applications/${view.id}`, {
        method: "PATCH",
        body: JSON.stringify({ resume, answers }),
      });
      applyView(next, true);
      setMessage({ tone: "success", text: "Saved. Your PDF is being updated." });
    });

  const setStatus = (status: Status) =>
    run("status", async () => {
      applyView(await api<ApplicationView>(`/api/applications/${view.id}`, { method: "PATCH", body: JSON.stringify({ status }) }));
      if (status === "APPLIED") setMessage({ tone: "success", text: "Marked as applied. Good luck! Update the status here when you hear back." });
    });

  const download = () =>
    run("pdf", async () => {
      const { url } = await api<{ url: string }>(`/api/applications/${view.id}/pdf`);
      window.location.assign(url);
    });

  const redraft = () =>
    run("redraft", async () => {
      await api(`/api/applications/${view.id}/tailor`, { method: "POST" });
      applyView(await api<ApplicationView>(`/api/applications/${view.id}`), true);
    });

  const pdfBusy = pdfTask && ACTIVE.includes(pdfTask.state);
  // The drafting task stays "needs input" in the history; the notice only matters while an answer is still empty.
  const answersStillNeeded = (view.answers?.content.answers ?? []).some((a) => a.needsInput && !a.answer.trim());
  const canDownload = Boolean(view.resume?.pdfReady) && !pdfBusy && !dirty;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{view.job.title}</h1>
          <p className="text-slate-700">
            {view.job.company}
            {view.job.location ? ` · ${view.job.location}` : ""}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2.5 py-0.5 font-medium ${STATUS_STYLES[view.status]}`}>{STATUS_LABELS[view.status]}</span>
            {view.appliedAt && <span className="text-slate-500">Applied {formatDay(view.appliedAt)}</span>}
            {view.responseAt && <span className="text-slate-500">· Response {formatDay(view.responseAt)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={download} disabled={!canDownload || busy !== null} title={dirty ? "Save your changes first" : undefined}>
            {busy === "pdf" || pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {pdfBusy ? "Preparing PDF…" : "Download PDF"}
          </Button>
          {view.job.applyUrl && (
            <Button asChild variant="outline">
              <a href={view.job.applyUrl} target="_blank" rel="noopener noreferrer">
                Open job page <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </Button>
          )}
          {view.status === "DRAFT" ? (
            <Button onClick={() => setStatus("APPLIED")} disabled={busy !== null}>
              <CheckCircle2 className="h-4 w-4" /> I&apos;ve applied
            </Button>
          ) : (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Status
              <select
                className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm"
                value={view.status}
                onChange={(e) => setStatus(e.target.value as Status)}
                disabled={busy !== null}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {view.status === "DRAFT" && (
        <p className="text-sm text-slate-600">
          Download the PDF, open the job page and apply there yourself. Then come back and press <strong>I&apos;ve applied</strong>.
          Pathfinder never submits applications for you.
        </p>
      )}

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <TaskBanner
        state={tailorTask?.state === "needs_input" && !answersStillNeeded ? "done" : tailorTask?.state}
        reason={tailorTask?.reason ?? ""}
        onRetry={redraft}
        busy={busy === "redraft"}
      />

      {resume && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-6">
            <ResumeEditor resume={resume} edit={editResume} />
            {answers && <AnswersEditor answers={answers} edit={editAnswers} />}
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-md">
              <Button onClick={save} disabled={!dirty || busy !== null}>
                {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </Button>
              <span className="text-sm text-slate-500">
                {dirty ? "You have unsaved changes." : `Version ${view.resume?.version ?? 1}${view.resume?.editedByStudent ? ", edited by you" : ""}.`}
              </span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={redraft} disabled={busy !== null || working}>
                <RefreshCw className="h-4 w-4" /> Redraft from my profile
              </Button>
            </div>
          </div>
          <aside className="flex flex-col gap-6">
            <GapsCard view={view} />
            <Card>
              <CardHeader title="The job" />
              <div className="max-h-[32rem] overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {view.job.description}
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}

function TaskBanner({ state, reason, onRetry, busy }: { state?: TaskStateView; reason: string; onRetry: () => void; busy: boolean }) {
  if (!state || state === "done") return null;
  if (state === "queued" || state === "working") {
    return (
      <Alert tone="info" className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {state === "queued" ? "Your draft is in the queue…" : "Writing your tailored resume and answers from your profile…"}
      </Alert>
    );
  }
  if (state === "needs_input") {
    return <Alert tone="info">{reason || "Your draft is ready. A few answers need your input: look for the highlighted ones below."}</Alert>;
  }
  return (
    <Alert tone="error" className="flex flex-wrap items-center gap-3">
      <span>{reason || "We couldn't prepare this draft."}</span>
      <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
        Try again
      </Button>
    </Alert>
  );
}

function GapsCard({ view }: { view: ApplicationView }) {
  const report = view.resume?.factCheck;
  if (!report) return null;
  return (
    <Card>
      <CardHeader title="Gaps" description="What this job asks for that your profile doesn't show. We never invent these." />
      {report.gaps.length === 0 ? (
        <p className="text-sm text-slate-600">No gaps found.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Gaps">
          {report.gaps.map((g) => (
            <li key={g} className="rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-950">
              {g}
            </li>
          ))}
        </ul>
      )}
      {report.removed.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">
            {report.removed.length} point{report.removed.length === 1 ? "" : "s"} left out because your profile doesn&apos;t support {report.removed.length === 1 ? "it" : "them"}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600" aria-label="Left out">
            {report.removed.map((r) => (
              <li key={r.text}>
                <span className="line-through">{r.text}</span> <span className="text-xs">({r.reason})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-4 text-xs text-slate-500">
        If you do have one of these, add it to your profile and press &quot;Redraft from my profile&quot;.
      </p>
    </Card>
  );
}

function EditedTag() {
  return <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">Edited by you</span>;
}

function ResumeEditor({ resume, edit }: { resume: ResumeContent; edit: (fn: (r: ResumeContent) => ResumeContent) => void }) {
  const sections = [
    { key: "experiences" as const, title: "Internships and work", items: resume.experiences.map((e) => ({ label: `${e.title}${e.company ? ` · ${e.company}` : ""}`, dates: e.dates, bullets: e.bullets })) },
    { key: "projects" as const, title: "Projects", items: resume.projects.map((p) => ({ label: p.name, dates: p.dates, bullets: p.bullets })) },
  ];
  return (
    <Card>
      <CardHeader
        title="Your tailored resume"
        description="Written only from your profile. Edit anything; what you write is yours to stand behind."
      />
      <div className="flex flex-col gap-5">
        <p className="text-sm text-slate-600">
          <strong className="text-slate-900">{resume.header.name || "Your name"}</strong>
          {[resume.header.email, resume.header.phone, resume.header.location].filter(Boolean).map((v) => ` · ${v}`)}
        </p>
        <Field label="Headline">
          {(p) => <Input {...p} value={resume.headline} onChange={(e) => edit((r) => ({ ...r, headline: e.target.value }))} />}
        </Field>
        <Field label="Summary">
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={resume.summary.text}
              onChange={(e) => edit((r) => ({ ...r, summary: { ...r.summary, text: e.target.value } }))}
            />
          )}
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Skills (from your profile, most relevant first)</p>
          <ul className="flex flex-wrap gap-2" aria-label="Resume skills">
            {resume.skills.map((s, i) => (
              <li key={s} className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm text-brand-800">
                {s}
                <button
                  type="button"
                  aria-label={`Remove ${s} from this resume`}
                  className="rounded-full p-0.5 hover:bg-brand-100"
                  onClick={() => edit((r) => ({ ...r, skills: r.skills.filter((_, j) => j !== i) }))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <div key={section.key} className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.title}</h3>
              {section.items.map((item, i) => (
                <fieldset key={`${section.key}-${i}`} className="rounded-md border border-slate-200 p-4">
                  <legend className="px-1 text-sm font-semibold text-slate-800">
                    {item.label}
                    {item.dates && <span className="font-normal text-slate-500"> · {item.dates}</span>}
                  </legend>
                  <div className="flex flex-col gap-3">
                    {item.bullets.map((b, j) => (
                      <div key={b.id} className="flex items-start gap-2">
                        <span className="mt-2 text-slate-400" aria-hidden>
                          •
                        </span>
                        <div className="flex-1">
                          <Textarea
                            aria-label={`${item.label}, point ${j + 1}`}
                            rows={2}
                            value={b.text}
                            onChange={(e) =>
                              edit((r) => {
                                r[section.key][i]!.bullets[j]!.text = e.target.value;
                                return r;
                              })
                            }
                          />
                          {(b.editedByStudent || b.factIds.length === 0) && (
                            <div className="mt-1">
                              <EditedTag />
                            </div>
                          )}
                        </div>
                        <Button
                          variant="danger"
                          size="icon"
                          aria-label={`Remove ${item.label}, point ${j + 1}`}
                          onClick={() =>
                            edit((r) => {
                              r[section.key][i]!.bullets.splice(j, 1);
                              return r;
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() =>
                        edit((r) => {
                          r[section.key][i]!.bullets.push({ id: `student-${crypto.randomUUID()}`, text: "", factIds: [], editedByStudent: true });
                          return r;
                        })
                      }
                    >
                      <Plus className="h-4 w-4" /> Add a point
                    </Button>
                  </div>
                </fieldset>
              ))}
            </div>
          ),
        )}
        {resume.education.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Education</h3>
            <ul className="text-sm text-slate-700">
              {resume.education.map((e) => (
                <li key={e.sourceId}>
                  {[e.degree, e.field].filter(Boolean).join(", ")} · {e.institution}
                  {e.dates ? ` · ${e.dates}` : ""}
                  {e.grade ? ` · ${e.grade}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">Education comes straight from your profile. Change it there.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function AnswersEditor({ answers, edit }: { answers: AnswersContent; edit: (fn: (a: AnswersContent) => AnswersContent) => void }) {
  return (
    <Card>
      <CardHeader title="Answers to common questions" description="Copy these into the application form if it asks." />
      <div className="flex flex-col gap-5">
        {answers.answers.map((a, i) => (
          <div key={a.id} className={a.needsInput && !a.answer ? "rounded-md border border-amber-300 bg-amber-50 p-3" : ""}>
            <Field label={a.question} hint={a.needsInput && !a.answer ? a.note || "Your profile doesn't say this. Please fill it in." : undefined}>
              {(p) => (
                <Textarea
                  {...p}
                  rows={4}
                  value={a.answer}
                  placeholder={a.needsInput ? "Write your answer" : undefined}
                  onChange={(e) =>
                    edit((x) => {
                      x.answers[i]!.answer = e.target.value;
                      return x;
                    })
                  }
                />
              )}
            </Field>
            {a.editedByStudent && (
              <div className="mt-1">
                <EditedTag />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

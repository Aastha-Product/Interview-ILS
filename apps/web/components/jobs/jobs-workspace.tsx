"use client";

import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JobCard } from "@/components/jobs/job-card";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { api, ApiRequestError } from "@/lib/api";
import type { JobCardData, SearchResponse } from "@/lib/jobs";

export function JobsWorkspace({
  myJobs,
  defaultQuery,
  defaultLocation,
}: {
  myJobs: JobCardData[];
  defaultQuery: string;
  defaultLocation: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <SearchPanel defaultQuery={defaultQuery} defaultLocation={defaultLocation} />
        <PastePanel />
      </div>
      <section aria-labelledby="my-jobs">
        <h2 id="my-jobs" className="mb-3 text-lg font-semibold">
          Your jobs, best match first
        </h2>
        {myJobs.length === 0 ? (
          <p className="text-sm text-slate-500">Jobs you search for or paste appear here with their match score.</p>
        ) : (
          <div className="grid gap-3">
            {myJobs.map((d) => (
              <JobCard key={d.job.id} data={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SearchPanel({ defaultQuery, defaultLocation }: { defaultQuery: string; defaultLocation: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultQuery);
  const [location, setLocation] = useState(defaultLocation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const params = new URLSearchParams({ query, location });
      setResult(await api<SearchResponse>(`/api/jobs?${params}`));
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Search jobs" description="From licensed job feeds. Each search is saved for 24 hours." />
      <form onSubmit={search} className="flex flex-col gap-3" role="search">
        <Field label="Role">
          {(p) => <Input {...p} value={query} placeholder="Software tester" onChange={(e) => setQuery(e.target.value)} />}
        </Field>
        <Field label="City">
          {(p) => <Input {...p} value={location} placeholder="Pune" onChange={(e) => setLocation(e.target.value)} />}
        </Field>
        <div>
          <Button type="submit" disabled={busy || query.trim().length < 2}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {busy ? "Searching and scoring…" : "Search"}
          </Button>
        </div>
      </form>
      {error && <Alert tone="error" className="mt-4">{error}</Alert>}
      {result && (
        <div className="mt-4 flex flex-col gap-3" role="region" aria-label="Search results">
          {result.notices.map((n) => (
            <Alert key={n} tone="info">
              {n}
            </Alert>
          ))}
          <p className="text-sm text-slate-600" aria-live="polite">
            {result.results.length} job{result.results.length === 1 ? "" : "s"} found
            {result.fromCache ? " (saved results from an earlier search)" : ""}.
          </p>
          {result.results.map((d) => (
            <JobCard key={d.job.id} data={d} />
          ))}
        </div>
      )}
    </Card>
  );
}

function PastePanel() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    setBusy(true);
    try {
      const body = showText ? { url, text, title, company, location } : { url };
      const result = await api<{ jobListingId: string }>("/api/jobs/import", { method: "POST", body: JSON.stringify(body) });
      router.push(`/jobs/${result.jobListingId}`);
    } catch (e) {
      if (e instanceof ApiRequestError) {
        if (e.code === "NEEDS_TEXT") setShowText(true);
        setFields(Object.fromEntries(e.fields.map((f) => [f.path, f.message])));
        setError(e.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Paste a job" description="Found a job on Naukri, LinkedIn or a company site? Add it here." />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={showText ? "Job link (optional)" : "Job link"} error={fields.url}>
          {(p) => <Input {...p} type="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />}
        </Field>
        {!showText && (
          <button type="button" className="self-start text-sm text-brand-700 underline" onClick={() => setShowText(true)}>
            Paste the job description instead
          </button>
        )}
        {showText && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Job title" error={fields.title}>
                {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
              <Field label="Company" error={fields.company}>
                {(p) => <Input {...p} value={company} onChange={(e) => setCompany(e.target.value)} />}
              </Field>
            </div>
            <Field label="City (optional)" error={fields.location}>
              {(p) => <Input {...p} value={location} onChange={(e) => setLocation(e.target.value)} />}
            </Field>
            <Field label="Job description" hint="Copy everything from the job page: role, requirements, skills." error={fields.text}>
              {(p) => <Textarea {...p} rows={8} value={text} onChange={(e) => setText(e.target.value)} />}
            </Field>
          </>
        )}
        <p className="text-xs text-slate-500">
          Pathfinder reads this one page for you. It never signs in to job sites or applies on your behalf.
        </p>
        <div>
          <Button type="submit" disabled={busy || (!url.trim() && !text.trim())}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Reading and scoring…" : "Add job"}
          </Button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Card>
  );
}

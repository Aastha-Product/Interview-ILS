"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { useJob } from "@/hooks/use-job";
import { cn } from "@/lib/cn";
import { retry } from "@/lib/jobs/actions";
import type { AnalyzeResumeResult } from "@/lib/jobs/analyze-resume";
import { messages } from "@/lib/messages";
import { ANALYSIS_STEPS } from "@/lib/resume-analysis-steps";

const ACCEPT = ".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain";

/**
 * Pathfinder's one primary action: upload a resume, watch the real steps of the analysis, and land
 * on the results. Nothing to configure. `initialJobId` follows an analysis already under way (?job=).
 */
export function ResumeUpload({ ready, initialJobId }: { ready: boolean; initialJobId: string | null }) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [revision, setRevision] = useState(0);
  const job = useJob<AnalyzeResumeResult>(jobId, revision);

  // Done: on to the results.
  const analysisId = job?.status === "DONE" ? job.result?.analysisId : undefined;
  useEffect(() => {
    if (analysisId) router.push(`/analyze/${analysisId}`);
  }, [analysisId, router]);

  const working = uploading || (jobId !== null && job?.status !== "FAILED");
  const current = uploading || !job ? 0 : job.status === "DONE" ? ANALYSIS_STEPS.length : Math.max(1, ANALYSIS_STEPS.indexOf((job.step ?? "") as (typeof ANALYSIS_STEPS)[number]));
  const failed = job?.status === "FAILED" ? (job.error ?? messages.unexpected) : null;

  const follow = (id: string | null) => {
    setJobId(id);
    router.replace(id ? `/analyze?job=${id}` : "/analyze");
  };

  function choose(chosen: File | null | undefined) {
    setUploadError(null);
    setFile(chosen ?? null);
  }

  async function upload() {
    if (!file) return setUploadError("Choose your resume file first.");
    setUploading(true);
    setUploadError(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      });
      const body = (await response.json().catch(() => null)) as { jobId?: string; error?: string } | null;
      if (!response.ok || !body?.jobId) setUploadError(body?.error ?? messages.unexpected);
      else follow(body.jobId);
    } catch {
      setUploadError(messages.offline);
    } finally {
      setUploading(false);
    }
  }

  async function tryAgain() {
    if (!jobId) return;
    const result = await retry({ id: jobId });
    if (result.ok) setRevision((value) => value + 1);
    else setUploadError(result.error);
  }

  function startOver() {
    follow(null);
    setFile(null);
    setUploadError(null);
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!working) choose(event.dataTransfer.files[0]);
  };

  if (working || failed) {
    return (
      <Card className="flex flex-col gap-6 px-6 py-8 sm:px-9">
        <h2 tabIndex={-1} className="font-serif text-section">
          {failed ? "The analysis stopped" : "Analysing your resume"}
        </h2>
        <ProgressSteps steps={ANALYSIS_STEPS} current={current} />
        {failed ? (
          <div role="alert" className="flex flex-col gap-3.5">
            <p className="text-control text-error">{failed}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void tryAgain()}>Try again</Button>
              <Button variant="text" onClick={startOver}>
                Choose another file
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-meta text-muted">This usually takes under a minute. You can leave this page and come back.</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-5 px-6 py-8 sm:px-9">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-10 text-center motion-safe:transition-colors",
          dragging ? "border-primary bg-selected" : "border-line-field bg-input hover:border-line-strong",
        )}
      >
        {/* The reference design's icon circle: its blue at 10%. */}
        <span className="grid size-16 place-items-center rounded-full bg-hover text-primary-text">
          <FileUp size={32} aria-hidden="true" />
        </span>
        <span className="text-field font-medium text-ink">{file ? file.name : "Drop your resume here, or choose a file"}</span>
        <span className="text-meta text-muted">PDF or Word (.docx), up to 5 MB</span>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </label>
      {!ready && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          Resume analysis isn&apos;t available on this server yet. Please try again later.
        </p>
      )}
      {uploadError && (
        <p role="alert" className="text-control text-error">
          {uploadError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => (file ? void upload() : input.current?.click())} disabled={!ready}>
          {file ? "Analyse my resume" : "Upload resume"}
        </Button>
        {file && (
          <Button variant="text" onClick={() => choose(null)}>
            Choose a different file
          </Button>
        )}
      </div>
    </Card>
  );
}

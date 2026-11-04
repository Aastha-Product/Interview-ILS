"use client";

import type { ProfileInput } from "@pathfinder/core/profile";
import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function ResumeUpload({ onParsed }: { onParsed: (draft: ProfileInput) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("That file is bigger than 5 MB. Save a smaller PDF or Word file and try again.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<{ draft: ProfileInput }>("/api/resume/import", { method: "POST", body: form });
      onParsed(result.draft);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        id="resume-file"
        aria-label="Resume file (PDF or Word)"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button size="lg" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />}
        {busy ? "Reading your resume… this can take up to a minute" : "Upload my resume"}
      </Button>
      <p className="text-xs text-slate-500">PDF or Word (.docx), up to 5 MB.</p>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

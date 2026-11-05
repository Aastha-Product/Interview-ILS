"use client";

import { useState, useTransition, type FormEvent } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/cn";

import { sendFeedback } from "./actions";

/** The feedback box: what went wrong or could be better, sent with the page it's about. */
export function FeedbackForm({ page }: { page: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!message.trim()) return setError("Write what happened or what you'd change.");
    startTransition(async () => {
      const result = await sendFeedback({ message, page });
      if (!result.ok) return setError(result.error);
      toastResult(result);
      setMessage("");
      setSent(true);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-[7px]">
        <label htmlFor="feedback" className="text-label text-muted">
          What happened, or what would you change?
        </label>
        <textarea
          id="feedback"
          rows={8}
          maxLength={5000}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            setError(null);
            setSent(false);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "feedback-error" : "feedback-hint"}
          className={cn(controlClassName, "min-h-40 p-3 text-sm")}
        />
        {error ? (
          <p id="feedback-error" role="alert" className="text-meta text-error">
            {error}
          </p>
        ) : (
          <p id="feedback-hint" className="text-meta text-muted">
            {page ? <>Sent with the page you came from ({page}). </> : null}
            Please don&apos;t include passwords or API keys.
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send feedback"}
        </Button>
        {sent && <span className="text-sm text-muted">Sent. Thank you!</span>}
      </div>
    </form>
  );
}

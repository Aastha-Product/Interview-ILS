"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { api, ApiRequestError } from "@/lib/api";

export function ExportCard() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account/export", { method: "POST" });
      if (response.status === 401) {
        // A full page load (not client navigation) so no stale signed-in state survives.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/signin");
        return;
      }
      if (!response.ok) throw new Error("export failed");
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "pathfinder-export.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      setMessage({ tone: "success", text: "Your data has been downloaded." });
    } catch {
      setMessage({ tone: "error", text: "We couldn't prepare your download. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Download your data"
        description="One file with your profile, job preferences, applications, drafts and activity."
      />
      <Button onClick={download} disabled={busy} variant="outline">
        {busy ? "Preparing…" : "Download my data"}
      </Button>
      {message && (
        <Alert tone={message.tone} className="mt-4">
          {message.text}
        </Alert>
      )}
    </Card>
  );
}

export function DeleteAccountCard({ email }: { email: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/account", { method: "DELETE", body: JSON.stringify({ confirmEmail: typed }) });
      // A full page load: the account and its session are gone, so drop every bit of client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/signin?deleted=1");
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-200">
      <CardHeader
        title="Delete your account"
        description="This permanently deletes your profile, uploaded resumes, drafts, PDFs and application history. It can't be undone."
      />
      <form onSubmit={remove} className="flex flex-col gap-4">
        <Field label={`Type ${email} to confirm`}>
          {(props) => (
            <Input {...props} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          )}
        </Field>
        <div>
          <Button type="submit" variant="danger" className="border border-red-300" disabled={!matches || busy}>
            {busy ? "Deleting…" : "Delete my account permanently"}
          </Button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Card>
  );
}

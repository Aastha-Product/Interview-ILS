"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api";

export function StartApplicationButton({ jobListingId, size = "sm" }: { jobListingId: string; size?: "sm" | "md" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [confirmSimilar, setConfirmSimilar] = useState(false);

  async function start(confirm = false) {
    setBusy(true);
    setMessage(null);
    try {
      const { applicationId } = await api<{ applicationId: string }>("/api/applications", {
        method: "POST",
        body: JSON.stringify({ jobListingId, confirmSimilar: confirm }),
      });
      router.push(`/applications/${applicationId}`);
    } catch (e) {
      if (!(e instanceof ApiRequestError)) {
        setMessage("Something went wrong. Please try again.");
      } else if (e.code === "ALREADY_STARTED") {
        setMessage(e.message);
        setExistingId(typeof e.details.applicationId === "string" ? e.details.applicationId : null);
      } else if (e.code === "SIMILAR_APPLICATION") {
        setMessage(e.message);
        setConfirmSimilar(true);
      } else {
        setMessage(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size={size} onClick={() => start(false)} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Start application
        </Button>
      </div>
      {message && (
        <Alert tone={existingId || confirmSimilar ? "info" : "error"} className="flex flex-col gap-2">
          <span>{message}</span>
          {existingId && (
            <Link href={`/applications/${existingId}`} className="font-medium underline">
              Open that application
            </Link>
          )}
          {confirmSimilar && (
            <span className="flex gap-2">
              <Button size="sm" onClick={() => start(true)} disabled={busy}>
                Yes, start this one too
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setConfirmSimilar(false); setMessage(null); }}>
                Cancel
              </Button>
            </span>
          )}
        </Alert>
      )}
    </div>
  );
}

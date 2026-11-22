"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { pauseEverything, resumeEverything } from "./actions";

/** Pause everything / Resume (Phase 3): one switch for auto-apply and the job agent together. */
export function PauseControl({ paused, running }: { paused: boolean; running: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!paused && !running) return null;
  const act = () =>
    startTransition(async () => {
      const result = toastResult(await (paused ? resumeEverything({}) : pauseEverything({})));
      if (result.ok) router.refresh();
    });
  return (
    <Button variant={paused ? "primary" : "secondary"} aria-disabled={pending || undefined} onClick={() => !pending && act()}>
      {pending ? (paused ? "Resuming…" : "Pausing…") : paused ? "Resume" : "Pause everything"}
    </Button>
  );
}

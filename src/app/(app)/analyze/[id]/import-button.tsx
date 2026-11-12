"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { importAnalysisIntoProfile } from "../actions";

/**
 * "Add this to my profile": merges the resume's details into the student's existing profile
 * (Pathfinder). Shown when the upload didn't auto-fill the profile because it already had data.
 */
export function ImportIntoProfileButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={pending}>
        Add this to my profile
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Add this resume to your profile?"
        description="We'll add what we found to the profile you already have: blanks are filled in and new entries added. Nothing you've written is removed, and you can edit everything afterwards."
        confirmLabel="Add to profile"
        onConfirm={() =>
          startTransition(async () => {
            if (toastResult(await importAnalysisIntoProfile({ id })).ok) router.refresh();
          })
        }
      />
    </>
  );
}

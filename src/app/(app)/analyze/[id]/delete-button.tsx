"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { deleteAnalysis } from "../actions";

/** Deletes this analysis after asking, then goes back home. */
export function DeleteAnalysisButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="danger-text" className="px-2!" onClick={() => setOpen(true)} disabled={pending}>
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this analysis?"
        description="It's removed from your account for good. Your profile stays as it is."
        confirmLabel="Delete analysis"
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteAnalysis({ id });
            if (!result.ok) return toast(result.error);
            toast("Analysis deleted.");
            router.replace("/analyze");
          })
        }
      />
    </>
  );
}

"use client";

import { useState } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { deleteMyAccount } from "./actions";

/**
 * "Delete my account" (Pathfinder, QA M-3): the student types their own email address to
 * confirm. Everything goes, the account included, and they're signed out.
 */
export function DeleteAccount() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const ready = typed.trim().length > 0;

  const remove = async () => {
    if (!ready || deleting) return;
    setDeleting(true);
    // On success the action signs you out and takes you to the homepage.
    const result = await deleteMyAccount({ email: typed });
    setDeleting(false);
    if (result && !result.ok) toast(result.error);
  };

  const cancel = () => {
    setConfirming(false);
    setTyped("");
  };

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="flex flex-col gap-3.5 rounded-panel border border-danger-line bg-danger-surface px-7 py-[22px]"
    >
      <div className="flex flex-col gap-1">
        <h3 id="delete-account-heading" className="text-[15px] font-medium text-error-strong">
          Delete my account
        </h3>
        <p className="text-control text-muted">
          Deletes your account and everything in it: your analyses, profile, settings, feedback and files. You&apos;re signed
          out straight away, and this can&apos;t be undone. Your Google account itself isn&apos;t affected.
        </p>
      </div>
      {confirming ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="delete-account-email" className="text-control text-muted">
            Type the email address you sign in with to confirm
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="delete-account-email"
              type="email"
              placeholder="you@example.com"
              // Opened on request, so the box takes focus.
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void remove();
                else if (event.key === "Escape") cancel();
              }}
              className="min-w-0 flex-[1_1_220px] rounded-control border border-line-input bg-input px-3 py-2.5 text-[13.5px] focus-visible:border-error-strong focus-visible:outline-offset-0"
            />
            <Button
              variant="danger"
              size="sm"
              aria-disabled={!ready || deleting || undefined}
              onClick={() => void remove()}
              className={ready ? undefined : "bg-danger-disabled hover:bg-danger-disabled"}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </Button>
            <Button variant="text" size="sm" className="px-3!" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="danger-outline" size="sm" onClick={() => setConfirming(true)}>
            Delete my account…
          </Button>
        </div>
      )}
    </section>
  );
}

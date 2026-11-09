"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { setStudentAllowance } from "./actions";

/**
 * One student's free analyses a day: empty means the server's default. Saves on "Save"; "Default"
 * clears what an admin set.
 */
export function AllowanceForm({ userId, email, allowance }: { userId: string; email: string; allowance: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(allowance === null ? "" : String(allowance));
  const [pending, startTransition] = useTransition();
  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 500);
  const changed = parsed !== allowance;

  const save = (analysesPerDay: number | null) =>
    startTransition(async () => {
      const result = await setStudentAllowance({ userId, analysesPerDay });
      if (!result.ok) return toast(result.error);
      if (result.toast) toast(result.toast);
      if (analysesPerDay === null) setValue("");
      router.refresh();
    });

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && changed) save(parsed);
      }}
    >
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={500}
        step={1}
        value={value}
        placeholder="Default"
        aria-label={`Free analyses a day for ${email}`}
        aria-invalid={!valid}
        onChange={(event) => setValue(event.target.value)}
        className="h-8 w-20 rounded-control border border-line bg-card px-2 text-sm tabular-nums aria-invalid:border-danger"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={pending || !valid || !changed}>
        Save
      </Button>
      {allowance !== null && (
        <Button type="button" variant="text" size="sm" className="px-1.5!" disabled={pending} onClick={() => save(null)}>
          Default
        </Button>
      )}
    </form>
  );
}

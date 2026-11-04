"use client";

import { preferencesSchema, type PreferencesInput } from "@pathfinder/core/profile";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { api, ApiRequestError } from "@/lib/api";

const LEVELS: Array<{ value: PreferencesInput["experienceLevel"]; label: string }> = [
  { value: "FRESHER", label: "Fresher (no full-time job yet)" },
  { value: "ZERO_TO_ONE", label: "Less than 1 year" },
  { value: "ONE_TO_THREE", label: "1 to 3 years" },
];

const splitList = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

export function PreferencesForm({
  initial,
  redirectTo,
  submitLabel = "Save preferences",
}: {
  initial: PreferencesInput | null;
  redirectTo?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [roles, setRoles] = useState((initial?.roles ?? []).join(", "));
  const [locations, setLocations] = useState((initial?.locations ?? []).join(", "));
  const [remoteOk, setRemoteOk] = useState(initial?.remoteOk ?? true);
  const [level, setLevel] = useState<PreferencesInput["experienceLevel"]>(initial?.experienceLevel ?? "FRESHER");
  const [minSalary, setMinSalary] = useState(initial?.minSalary ? String(initial.minSalary) : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const candidate = {
      roles: splitList(roles),
      locations: splitList(locations),
      remoteOk,
      experienceLevel: level,
      minSalary: minSalary.trim() ? Number(minSalary.replace(/[,\s]/g, "")) : null,
    };
    const parsed = preferencesSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api("/api/preferences", { method: "PUT", body: JSON.stringify(parsed.data) });
      if (redirectTo) router.push(redirectTo);
      else setMessage({ tone: "success", text: "Saved." });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiRequestError ? e.message : "Something went wrong. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Roles you want" hint="Separate with commas, e.g. Software Tester, QA Engineer, Data Analyst" error={errors.roles}>
          {(p) => <Input {...p} value={roles} onChange={(e) => setRoles(e.target.value)} />}
        </Field>
        <Field label="Cities" hint="Separate with commas, e.g. Bengaluru, Pune, Indore" error={errors.locations}>
          {(p) => <Input {...p} value={locations} onChange={(e) => setLocations(e.target.value)} />}
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={remoteOk} onChange={(e) => setRemoteOk(e.target.checked)} />
          I&apos;m open to remote jobs
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Your experience</legend>
          {LEVELS.map((l) => (
            <label key={l.value} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="level" className="h-4 w-4 accent-brand-600" checked={level === l.value} onChange={() => setLevel(l.value)} />
              {l.label}
            </label>
          ))}
        </fieldset>
        <Field label="Lowest yearly salary you'd accept, in rupees (optional)" hint="For example: 300000" error={errors.minSalary}>
          {(p) => <Input {...p} inputMode="numeric" value={minSalary} onChange={(e) => setMinSalary(e.target.value)} />}
        </Field>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <div>
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

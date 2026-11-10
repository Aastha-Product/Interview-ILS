"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { NOTICE_PERIODS, type SavedAnswers } from "@/lib/apply/answers";
import type { AutoApplyView } from "@/lib/apply/settings";
import type { Country } from "@/lib/job-search/countries";
import { EMPLOYMENT_TYPES, type EmploymentType, type Level, type MatchPreferences } from "@/lib/match/preferences";

import { agreeToAutoApply, saveJobSearch } from "../actions";

/** "Data Analyst, Business Analyst" → ["Data Analyst", "Business Analyst"]. */
export const listFrom = (text: string) => [...new Set(text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
const listText = (items: readonly string[]) => items.join(", ");

const LEVEL_LABELS: Record<Level, string> = { intern: "Intern", entry: "Fresher or entry level (under 2 years)", experienced: "Experienced (2 years or more)" };
const TYPE_LABELS: Record<EmploymentType, string> = { "full-time": "Full-time", internship: "Internship", "part-time": "Part-time", contract: "Contract" };
const NOTICE_LABELS: Record<(typeof NOTICE_PERIODS)[number], string> = { immediate: "Can join immediately", "15": "15 days", "30": "30 days", "60": "60 days", "90": "90 days" };
const DAILY = [1, 2, 3, 5, 10, 15, 20, 30];
const PER_COMPANY = [1, 2, 3, 5];

type YesNoKey = "workAuthorized" | "needsSponsorship" | "relativesAtCompany" | "backgroundCheckConsent" | "acceptPrivacyNotices" | "outsideActivities" | "willingToRelocate";

/** The yes/no questions forms ask most, as the student sees them. */
const YES_NO: { key: YesNoKey; label: string; hint?: string }[] = [
  { key: "workAuthorized", label: "Are you legally allowed to work in the country of the jobs you're applying to?" },
  { key: "needsSponsorship", label: "Will you need visa sponsorship?" },
  { key: "relativesAtCompany", label: "Do you have a relative or close friend working at the companies you apply to?", hint: "Most forms ask. Answer no only if that's true for every company." },
  { key: "backgroundCheckConsent", label: "Do you agree to employers' background verification?" },
  { key: "acceptPrivacyNotices", label: "Do you agree to employers' privacy notices for processing your application?", hint: "Many forms won't take an application without it." },
  { key: "outsideActivities", label: "Do you have advisory, consulting or board roles besides your job or studies?" },
  { key: "willingToRelocate", label: "Are you willing to relocate for a job?" },
];

const answerValue = (value: boolean | null) => (value === null ? "" : value ? "yes" : "no");
const fromAnswer = (value: string) => (value === "" ? null : value === "yes");

export type SetupScreenProps = {
  settings: AutoApplyView;
  preferences: MatchPreferences;
  consentText: string;
  countries: readonly Country[];
};

/** Set up job search (auto-apply step 4): what to look for, the answers forms ask for, the limits, and consent. */
export function SetupScreen({ settings, preferences, consentText, countries }: SetupScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [titles, setTitles] = useState(listText(preferences.titles));
  const [skills, setSkills] = useState(listText(preferences.skills));
  const [country, setCountry] = useState(preferences.countries[0] ?? "in");
  const [cities, setCities] = useState(listText(preferences.cities));
  const [remoteOk, setRemoteOk] = useState(preferences.remoteOk);
  const [level, setLevel] = useState<Level>(preferences.level);
  const [types, setTypes] = useState<EmploymentType[]>(preferences.employmentTypes);
  const [answers, setAnswers] = useState<SavedAnswers>(settings.answers);
  const [minTier, setMinTier] = useState(settings.minTier);
  const [dailyLimit, setDailyLimit] = useState(settings.dailyLimit);
  const [perCompanyLimit, setPerCompanyLimit] = useState(settings.perCompanyLimit);
  const [dryRun, setDryRun] = useState(settings.dryRun);
  const [agreed, setAgreed] = useState(false);
  const [titleError, setTitleError] = useState<string | undefined>();

  const answer = (patch: Partial<SavedAnswers>) => setAnswers((current) => ({ ...current, ...patch }));
  const unanswered = YES_NO.filter(({ key }) => answers[key] === null).length + (answers.noticePeriod === null ? 1 : 0);

  const save = () => {
    const roleList = listFrom(titles);
    if (roleList.length === 0) {
      setTitleError("Add at least one role you're looking for.");
      return;
    }
    setTitleError(undefined);
    startTransition(async () => {
      const saved = toastResult(
        await saveJobSearch({
          preferences: { titles: roleList, skills: listFrom(skills), countries: [country], cities: listFrom(cities), remoteOk, level, employmentTypes: types },
          minTier,
          dailyLimit,
          perCompanyLimit,
          dryRun,
          answers,
        }),
      );
      if (!saved.ok) return;
      if (!settings.consented && agreed && !toastResult(await agreeToAutoApply({})).ok) return;
      router.push("/auto-apply");
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Set up job search"
        description="Tell Pathfinder what you're looking for and answer the questions most application forms ask, once. It uses only your profile and these answers, and never makes anything up."
      />

      <Card padding="none" className="flex flex-col gap-5 px-7 py-[26px]">
        <h2 className="text-field font-medium">What you&apos;re looking for</h2>
        <Input
          label="Roles"
          hint="Separate them with commas, e.g. Data Analyst, Business Analyst."
          value={titles}
          onChange={(event) => setTitles(event.target.value)}
          error={titleError}
        />
        <Input label="Skills" hint="From your profile; matching looks for these in each job." value={skills} onChange={(event) => setSkills(event.target.value)} />
        <div className="grid gap-x-[18px] gap-y-5 sm:grid-cols-2">
          <Select label="Country" value={country} onChange={(event) => setCountry(event.target.value)}>
            {countries.map(({ code, name }) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
          <Input label="Cities" hint="Leave empty for anywhere in the country." value={cities} onChange={(event) => setCities(event.target.value)} />
          <Select label="Experience" value={level} onChange={(event) => setLevel(event.target.value as Level)}>
            {(Object.keys(LEVEL_LABELS) as Level[]).map((value) => (
              <option key={value} value={value}>
                {LEVEL_LABELS[value]}
              </option>
            ))}
          </Select>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-field font-medium">Kinds of job</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {EMPLOYMENT_TYPES.map((type) => (
                <Checkbox
                  key={type}
                  label={TYPE_LABELS[type]}
                  checked={types.includes(type)}
                  onChange={(event) => setTypes((current) => (event.target.checked ? [...current, type] : current.filter((entry) => entry !== type)))}
                />
              ))}
            </div>
            <p className="text-meta text-muted">None ticked means any.</p>
          </fieldset>
        </div>
        <Toggle label="Remote jobs too" description="Remote jobs open to people in your country, or anywhere." checked={remoteOk} onCheckedChange={setRemoteOk} />
      </Card>

      <Card padding="none" className="flex flex-col gap-5 px-7 py-[26px]">
        <div className="flex flex-col gap-1">
          <h2 className="text-field font-medium">Questions forms ask</h2>
          <p className="text-meta text-muted">
            Answered once here, used on every form that asks.
            {unanswered > 0 ? ` ${unanswered} still unanswered: an application asking one of them waits for you.` : ""}
          </p>
        </div>
        <div className="grid gap-x-[18px] gap-y-5 sm:grid-cols-2">
          {YES_NO.map(({ key, label, hint }) => (
            <Select key={key} label={label} hint={hint} value={answerValue(answers[key])} onChange={(event) => answer({ [key]: fromAnswer(event.target.value) })}>
              <option value="">Not answered</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          ))}
          <Select
            label="Notice period"
            value={answers.noticePeriod ?? ""}
            onChange={(event) => answer({ noticePeriod: (event.target.value || null) as SavedAnswers["noticePeriod"] })}
          >
            <option value="">Not answered</option>
            {NOTICE_PERIODS.map((period) => (
              <option key={period} value={period}>
                {NOTICE_LABELS[period]}
              </option>
            ))}
          </Select>
          <Input label="Current salary" hint="As you'd write it, e.g. 4.5 LPA. Leave empty if you have none." value={answers.currentSalary} onChange={(event) => answer({ currentSalary: event.target.value })} />
          <Input label="Expected salary" hint="e.g. 6 LPA" value={answers.expectedSalary} onChange={(event) => answer({ expectedSalary: event.target.value })} />
          <Input
            label="Graduation year"
            hint="Leave empty to use your profile's latest education."
            inputMode="numeric"
            maxLength={4}
            value={answers.graduationYear}
            onChange={(event) => answer({ graduationYear: event.target.value.replace(/\D/g, "") })}
          />
        </div>
      </Card>

      <Card padding="none" className="grid gap-x-[18px] gap-y-5 px-7 py-[26px] sm:grid-cols-2">
        <h2 className="text-field font-medium sm:col-span-2">Limits</h2>
        <Select label="Apply for" value={minTier} onChange={(event) => setMinTier(event.target.value as "STRONG" | "GOOD")}>
          <option value="STRONG">Strong matches only</option>
          <option value="GOOD">Strong and good matches</option>
        </Select>
        <Select label="Applications a day, at most" value={String(dailyLimit)} onChange={(event) => setDailyLimit(Number(event.target.value))}>
          {DAILY.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Select label="To one company in 30 days, at most" value={String(perCompanyLimit)} onChange={(event) => setPerCompanyLimit(Number(event.target.value))}>
          {PER_COMPANY.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Toggle
          className="sm:col-span-2"
          label="Dry run"
          description={dryRun ? "On: forms are filled in your browser but not submitted, so you can check them first." : "Off: applications are submitted for you."}
          checked={dryRun}
          onCheckedChange={setDryRun}
        />
      </Card>

      {settings.consented ? null : (
        <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
          <h2 className="text-field font-medium">{settings.consentOutdated ? "How auto-apply works has changed" : "Before Pathfinder applies for you"}</h2>
          <p className="text-meta">{consentText}</p>
          <Checkbox label="I agree" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" aria-disabled={pending || undefined} onClick={() => !pending && save()}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Link href="/auto-apply" className={buttonClassName("text", "lg")}>
          Cancel
        </Link>
      </div>
    </div>
  );
}

"use client";

import { emptyProfile, type ProfileInput } from "@pathfinder/core/profile";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProfileEditor } from "@/components/profile-editor";
import { ResumeUpload } from "@/components/resume-upload";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Step = { kind: "choose" } | { kind: "review"; draft: ProfileInput; imported: boolean };

export function OnboardingFlow({ currentVersion }: { currentVersion: number }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "choose" });

  if (step.kind === "review") {
    return (
      <div className="flex flex-col gap-4">
        <StepHeader
          number={2}
          title={step.imported ? "Check what we read from your resume" : "Build your profile"}
          text="This profile is the only source Pathfinder uses when it drafts applications for you, so make sure it's accurate."
        />
        <ProfileEditor
          initial={step.draft}
          initialVersion={currentVersion}
          mode={step.imported ? "review" : "edit"}
          saveLabel="Save and continue"
          onSaved={() => router.push("/onboarding/preferences")}
        />
        <div>
          <Button variant="ghost" onClick={() => setStep({ kind: "choose" })}>
            ← Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <StepHeader
        number={1}
        title="Let's set up your profile"
        text="Start from your existing resume and we'll fill in the details for you to check, or start with a blank profile."
      />
      <Card className="flex flex-col gap-6">
        <div>
          <h2 className="mb-1 font-semibold">Upload your resume</h2>
          <p className="mb-4 text-sm text-slate-600">
            We read the text and pre-fill your profile. You review everything before it&apos;s saved.
          </p>
          <ResumeUpload onParsed={(draft) => setStep({ kind: "review", draft, imported: true })} />
        </div>
        <div className="border-t border-slate-200 pt-6">
          <h2 className="mb-1 font-semibold">No resume yet?</h2>
          <p className="mb-4 text-sm text-slate-600">Fill in your profile step by step instead.</p>
          <Button variant="outline" onClick={() => setStep({ kind: "review", draft: emptyProfile(), imported: false })}>
            Start with a blank profile
          </Button>
        </div>
      </Card>
    </div>
  );
}

function StepHeader({ number, title, text }: { number: number; title: string; text: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-brand-700">Step {number} of 3</p>
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-1 text-slate-600">{text}</p>
    </div>
  );
}

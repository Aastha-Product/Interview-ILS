import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

// A plain-language summary for the MVP. The full notice is drafted in Phase 5 and needs a legal check.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">How Pathfinder uses your data</h1>
      <div className="flex flex-col gap-4 text-slate-700">
        <p>
          <strong>What we collect:</strong> your name and email from Google sign-in, the resume file you upload, the profile
          you build, your job preferences, and the applications you track.
        </p>
        <p>
          <strong>Why:</strong> to draft resumes and answers for jobs you choose, using only facts from your profile, and to
          show you how your applications are going.
        </p>
        <p>
          <strong>AI:</strong> when you import a resume or draft an application, the relevant text is sent to our AI provider
          (Google Gemini) to process. We don&apos;t keep the prompts we send.
        </p>
        <p>
          <strong>What we never do:</strong> log in to job portals, ask for your portal passwords, or submit applications for
          you. You always apply yourself.
        </p>
        <p>
          <strong>Your control:</strong> you can export everything or delete your account and all its data from Settings
          (coming soon in this pilot).
        </p>
      </div>
      <p className="mt-8">
        <Link href="/signin" className="text-brand-700 underline">
          Back
        </Link>
      </p>
    </main>
  );
}

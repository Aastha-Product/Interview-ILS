import type { Metadata } from "next";

import { FeedbackForm } from "./feedback-form";

export const metadata: Metadata = { title: "Send feedback" };

/** Where testers tell the team what's broken or could be better (Pathfinder). */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { from } = await searchParams;
  const page = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from.slice(0, 300) : "";
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">Send feedback</h1>
        <p className="text-sm text-muted">
          You&apos;re testing an early version. Tell us what didn&apos;t work, what was confusing, or what you&apos;d like. Only
          the team reads this.
        </p>
      </div>
      <FeedbackForm page={page} />
    </div>
  );
}

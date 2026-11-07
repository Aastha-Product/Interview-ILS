import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";

/** What a student gets, on the sign-in card's left panel: Pathfinder's own features. */
const WHAT_YOU_GET = [
  "A clear analysis of your resume",
  "Strengths, quoted from your own resume",
  "Concrete changes to make",
  "What employers look for that's missing",
  "Every past analysis, kept for you",
  "Private to your account, never sold",
];

/**
 * The frame of the sign-in, sign-up and password reset pages, outside the app shell, laid out as
 * the reference design's sign-in: a navy page, a white card with a blue-to-navy panel listing what
 * Pathfinder does, and the form. The brand links back to the homepage; under the form, what
 * signing in agrees to.
 */
export function AuthShell({ children, footnote }: { children: ReactNode; footnote?: ReactNode }) {
  return (
    // Light, as the reference's sign-in card, whatever the visitor's scheme.
    <main className="flex min-h-screen items-center justify-center light-page bg-brand-navy px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-5xl overflow-hidden rounded-control bg-white shadow-dialog">
        <div className="flex flex-col md:flex-row">
          <div className="on-navy bg-brand-gradient-diagonal p-8 md:w-5/12">
            <Link href="/" className="mb-8 flex items-center gap-2 text-white hover:text-white">
              <BrandMark className="size-8" />
              <span className="text-xl font-bold">Pathfinder</span>
            </Link>
            <p className="text-2xl font-bold text-white md:mb-8 md:text-3xl">See your resume the way an employer will</p>
            <ul className="hidden flex-col gap-4 md:flex">
              {WHAT_YOU_GET.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check className="mt-0.5 size-5 shrink-0 text-check-on-navy" aria-hidden="true" />
                  <span className="font-medium text-white">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white p-8 md:w-7/12">
            <div className="mx-auto flex w-full max-w-md flex-col gap-6">
              {children}
              {footnote && <p className="text-sm leading-[1.6] text-pretty text-muted">{footnote}</p>}
              {/* Pathfinder: the DPDP Act asks for the notice before students sign up. */}
              <p className="text-center text-sm leading-[1.6] text-pretty text-muted">
                By signing in, you agree to how we use your data, as described in the{" "}
                <Link href="/privacy" className="font-medium text-primary-text hover:underline">
                  privacy notice
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

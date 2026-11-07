import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";

/**
 * The frame of the sign-in, sign-up and password reset pages, outside the app shell: the brand
 * links back to the homepage, then the form, then what signing in agrees to.
 */
export function AuthShell({ children, footnote }: { children: ReactNode; footnote?: ReactNode }) {
  return (
    // The form on the panel's colour, a warm wash on the right.
    <main className="grid min-h-screen bg-surface min-[960px]:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="flex w-full max-w-[400px] flex-col gap-8">
          <Link href="/" className="flex flex-col items-start gap-2 text-ink hover:text-ink">
            <BrandMark className="size-10" />
            <span className="flex flex-col">
              <span className="font-serif text-[30px] font-medium tracking-[-0.01em]">Pathfinder</span>
              <span className="text-sm text-muted">Resume analysis for students and graduates</span>
            </span>
          </Link>
          {children}
          {footnote && <p className="text-meta leading-[1.6] text-pretty text-muted">{footnote}</p>}
          {/* Pathfinder: the DPDP Act asks for the notice before students sign up. */}
          <p className="text-meta leading-[1.6] text-pretty text-muted">
            By signing in, you agree to how we use your data, as described in the{" "}
            <Link href="/privacy" className="font-medium text-ink underline underline-offset-2">
              privacy notice
            </Link>
            .
          </p>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="hidden bg-[linear-gradient(to_left,color-mix(in_srgb,var(--color-ink)_9%,transparent)_0%,transparent_65%)] min-[960px]:grid min-[960px]:place-items-center"
      >
        <BrandMark className="size-40 rounded-[36px] opacity-90 shadow-dialog" />
      </div>
    </main>
  );
}

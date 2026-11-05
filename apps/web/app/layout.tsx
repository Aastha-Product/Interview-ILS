import { getConfig } from "@pathfinder/core";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { environmentNotice } from "@/server/environment";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { indexable } = environmentNotice(getConfig().APP_ENV);
  return {
    title: { default: "Pathfinder", template: "%s · Pathfinder" },
    description: "Apply to jobs with a resume tailored from your own profile.",
    robots: indexable ? undefined : { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the request headers renders every page per request, which the nonce-based CSP set in
  // proxy.ts needs: a page built ahead of time would carry scripts without this request's nonce.
  await headers();
  const { banner } = environmentNotice(getConfig().APP_ENV);
  return (
    <html lang="en">
      <body className="min-h-screen">
        {banner && (
          <div role="note" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
            {banner}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pathfinder", template: "%s · Pathfinder" },
  description: "Apply to jobs with a resume tailored from your own profile.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the request headers renders every page per request, which the nonce-based CSP set in
  // proxy.ts needs: a page built ahead of time would carry scripts without this request's nonce.
  await headers();
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/auth/next-path";
import { googleConnection } from "@/lib/google/account";
import { linkedinSearchUrl } from "@/lib/outreach";
import { loadOutreach, OutreachError } from "@/lib/outreach-data";
import { toolsEnabled } from "@/lib/tools";

import { OutreachEditor, type Sender } from "../outreach-editor";

export const metadata: Metadata = { title: "Recruiter outreach" };

export default async function OutreachApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  if (!toolsEnabled()) redirect(HOME_PATH);
  const { id } = await params;
  const [view, google] = await Promise.all([
    loadOutreach(id).catch((error: unknown) => {
      if (error instanceof OutreachError) notFound();
      throw error;
    }),
    googleConnection(),
  ]);
  const sender: Sender =
    google.status === "connected"
      ? google.canSend
        ? { from: google.email }
        : { from: null, reason: "no-permission" }
      : { from: null, reason: google.status === "not-configured" ? "not-configured" : "not-connected" };
  return <OutreachEditor view={view} sender={sender} linkedin={linkedinSearchUrl(view.company)} />;
}

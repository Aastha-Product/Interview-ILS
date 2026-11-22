"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { copyText } from "@/lib/copy-text";
import { LINKEDIN_NOTE_MAX, OUTREACH_PER_DAY, recipientLine, sendProblem, STAGE_LABELS } from "@/lib/outreach";
import type { OutreachView } from "@/lib/outreach-data";

import { draftOutreachEmail, saveOutreachDraft, sendOutreachEmail } from "./actions";

/** Whether Gmail can send: the account it sends from, or why not. */
export type Sender = { from: string } | { from: null; reason: "not-configured" | "not-connected" | "no-permission" };

const dateText = (date: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(date));

/**
 * One application's recruiter email (Phase 3): who it's to, the AI's draft to edit, a LinkedIn
 * note to copy, and sending from Gmail after a confirmation that says exactly what goes where.
 */
export function OutreachEditor({ view, sender, linkedin }: { view: OutreachView; sender: Sender; linkedin: string }) {
  const router = useRouter();
  const [contactName, setContactName] = useState(view.contactName);
  const [contactEmail, setContactEmail] = useState(view.contactEmail);
  const [subject, setSubject] = useState(view.subject);
  const [body, setBody] = useState(view.body);
  const [note, setNote] = useState(view.linkedinNote);
  const [followUp, setFollowUp] = useState(view.followUpBody);
  const [confirming, setConfirming] = useState(false);
  const [busy, startWork] = useTransition();

  const sent = view.sentAt !== null;
  const followUpOpen = sent && !view.followUpSentAt && view.stage !== "replied";
  const followUpReady = view.stage === "follow-up-due" || followUp.trim().length > 0;
  const atLimit = view.sentToday >= OUTREACH_PER_DAY;

  const fields = () => ({ applicationId: view.applicationId, contactName, contactEmail, subject, body, linkedinNote: note, followUpBody: followUp });

  const save = (then?: () => void) =>
    startWork(async () => {
      const result = await saveOutreachDraft(fields());
      if (!result.ok) return toast(result.error);
      if (then) then();
      else toast("Saved.");
      router.refresh();
    });

  const draft = () =>
    startWork(async () => {
      const saved = await saveOutreachDraft(fields());
      if (!saved.ok) return toast(saved.error);
      const result = await draftOutreachEmail({ applicationId: view.applicationId });
      if (!result.ok) return toast(result.error);
      toast(result.toast ?? "Drafted.");
      // The page reloads with the draft; the fields take it from there.
      window.location.reload();
    });

  const send = () =>
    startWork(async () => {
      setConfirming(false);
      const result = await sendOutreachEmail({ applicationId: view.applicationId });
      if (!result.ok) return toast(result.error);
      toast(result.toast ?? "Sent.");
      router.refresh();
    });

  const askToSend = () => {
    const problem = sendProblem({ contactEmail, subject, body: sent ? followUp : body });
    if (problem) return toast(problem);
    if (atLimit) return toast(`You've sent ${OUTREACH_PER_DAY} recruiter emails in the last day. Send the rest tomorrow.`);
    save(() => setConfirming(true));
  };

  const sendButton =
    sender.from === null ? (
      sender.reason === "not-configured" ? (
        <p className="text-meta text-muted">Sending needs Gmail, which isn&apos;t set up on this server yet. Copy the email into your own mail for now.</p>
      ) : (
        <a href={sender.reason === "no-permission" ? "/api/google/connect?scopes=send" : "/settings?section=google"} className={buttonClassName("secondary", "md")}>
          {sender.reason === "no-permission" ? "Allow sending with Gmail" : "Connect Gmail to send"}
        </a>
      )
    ) : (
      <Button aria-disabled={busy || undefined} onClick={() => !busy && askToSend()}>
        {sent ? "Send follow-up" : "Send with Gmail"}
      </Button>
    );

  return (
    <>
      <PageHeader title={`${view.role || "Untitled role"} at ${view.company || "the company"}`} description={`Recruiter outreach · ${STAGE_LABELS[view.stage]}`} />
      <div className="flex max-w-[960px] flex-col gap-6 px-4 pb-20 sm:px-10">
        <p className="text-sm">
          <Link href="/outreach" className="font-medium underline underline-offset-2">
            ← All outreach
          </Link>
          {" · "}
          <Link href={`/applications/${view.applicationId}`} className="font-medium underline underline-offset-2">
            The application
          </Link>
          {view.postingUrl ? (
            <>
              {" · "}
              <a href={view.postingUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                The posting
              </a>
            </>
          ) : null}
        </p>

        {view.stage === "replied" ? (
          <Card>
            <p className="text-sm">
              <span className="font-medium">They replied.</span> Read and answer it in{" "}
              <Link href="/inbox" className="font-medium underline underline-offset-2">
                Inbox
              </Link>
              .
            </p>
          </Card>
        ) : null}

        <section aria-labelledby="outreach-contact">
          <Card className="flex flex-col gap-4">
            <h2 id="outreach-contact" className="font-serif text-section">
              Who it&apos;s to
            </h2>
            <p className="text-meta text-muted">
              Use an address the posting or the recruiter gives. Pathfinder never guesses one. To find the recruiter, search LinkedIn yourself, then copy their name here.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" value={contactName} disabled={sent} onChange={(event) => setContactName(event.target.value)} placeholder="Priya Sharma" />
              <Input label="Email address" type="email" value={contactEmail} disabled={sent} onChange={(event) => setContactEmail(event.target.value)} placeholder="priya@company.com" />
            </div>
            {!sent && view.suggestions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-meta text-muted">In the posting:</span>
                {view.suggestions.map((address) => (
                  <button key={address} type="button" className={buttonClassName("secondary", "sm")} onClick={() => setContactEmail(address)}>
                    {address}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="text-sm">
              <a href={linkedin} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                Find {view.company || "the company"}&apos;s recruiters on LinkedIn
              </a>
            </p>
          </Card>
        </section>

        <section aria-labelledby="outreach-email">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="outreach-email" className="font-serif text-section">
                The email
              </h2>
              {sent ? (
                <span className="text-meta text-muted">Sent {dateText(view.sentAt!)}</span>
              ) : (
                <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && draft()}>
                  {busy ? "Working…" : subject || body ? "Draft again with AI" : "Draft with AI"}
                </Button>
              )}
            </div>
            <Input label="Subject" value={subject} disabled={sent} onChange={(event) => setSubject(event.target.value)} />
            <Textarea label="Message" rows={10} value={body} disabled={sent} onChange={(event) => setBody(event.target.value)} />
            {!sent ? (
              <div className="flex flex-wrap items-center gap-3">
                {sendButton}
                <Button variant="text" aria-disabled={busy || undefined} onClick={() => !busy && save()}>
                  Save draft
                </Button>
              </div>
            ) : null}
          </Card>
        </section>

        {followUpOpen ? (
          <section aria-labelledby="outreach-follow-up">
            <Card className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="outreach-follow-up" className="font-serif text-section">
                  Follow-up
                </h2>
                {followUpReady ? (
                  <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && draft()}>
                    {busy ? "Working…" : followUp ? "Draft again with AI" : "Draft with AI"}
                  </Button>
                ) : null}
              </div>
              {followUpReady ? (
                <>
                  <Textarea label="Message" hint="Goes in the same thread, once. Then let it rest." rows={7} value={followUp} onChange={(event) => setFollowUp(event.target.value)} />
                  <div className="flex flex-wrap items-center gap-3">
                    {sendButton}
                    <Button variant="text" aria-disabled={busy || undefined} onClick={() => !busy && save()}>
                      Save draft
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-meta text-muted">No reply yet. If there&apos;s still none after a few days (your quiet days in Settings), you can follow up once.</p>
              )}
            </Card>
          </section>
        ) : view.followUpSentAt ? (
          <p className="text-meta text-muted">Follow-up sent {dateText(view.followUpSentAt)}.</p>
        ) : null}

        <section aria-labelledby="outreach-linkedin">
          <Card className="flex flex-col gap-4">
            <h2 id="outreach-linkedin" className="font-serif text-section">
              LinkedIn note
            </h2>
            <p className="text-meta text-muted">Pathfinder never sends anything on LinkedIn. Copy this into a connection request yourself, if you like.</p>
            <Textarea label="Note" hint={`${note.length} of ${LINKEDIN_NOTE_MAX} characters`} rows={3} maxLength={LINKEDIN_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                aria-disabled={!note.trim() || undefined}
                onClick={async () => {
                  if (!note.trim()) return toast("Draft the email with AI first, or write a note.");
                  toast((await copyText(note)) ? "Copied." : "Couldn't copy. Select the text and copy it.");
                }}
              >
                Copy note
              </Button>
              <Button variant="text" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && save()}>
                Save note
              </Button>
            </div>
          </Card>
        </section>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={sent ? "Send this follow-up?" : "Send this email?"}
        description={
          <span className="flex flex-col gap-1">
            <span>From {sender.from ?? "your Gmail"}</span>
            <span>To {recipientLine(contactName, contactEmail)}</span>
            <span>Subject {sent ? `Re: ${subject}` : subject}</span>
          </span>
        }
        confirmLabel={sent ? "Send follow-up" : "Send email"}
        onConfirm={send}
      />
    </>
  );
}

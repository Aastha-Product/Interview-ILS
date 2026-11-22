"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_LINKS_PER_PASTE, parseBoardLink, SYSTEM_NAMES, type BoardLink } from "@/lib/crawl/board-links";
import type { AddBoardsResult, AddedBoard } from "@/lib/crawl/boards-admin";

import { addJobBoardsFromLinks, switchJobBoard } from "./actions";

const boardKey = (board: Pick<BoardLink, "system" | "boardToken">) => `${board.system}:${board.boardToken.toLowerCase()}`;

/** What happened to one pasted board, in words. */
export function outcomeText(result: AddedBoard): string {
  const board = `${result.board.name} (${SYSTEM_NAMES[result.board.system]})`;
  switch (result.kind) {
    case "added":
      return `Added ${board}: ${result.relevantJobs} open ${result.relevantJobs === 1 ? "job" : "jobs"} in your countries. It's crawled at the next look.`;
    case "exists":
      return `${board} is already on the list.`;
    case "not-found":
      return `${board}: no such board. Check the link.`;
    case "no-jobs":
      return `${board} wasn't added: ${result.openJobs > 0 ? `its ${result.openJobs} open jobs are all elsewhere` : "it has no open jobs"}.`;
    case "unavailable":
      return `${board} couldn't be checked just now. Try it again later.`;
  }
}

/**
 * Admin → Job boards (Phase 2): paste careers links to add boards, each checked live against its
 * public API before it's kept.
 */
export function AddJobBoards() {
  const router = useRouter();
  const [links, setLinks] = useState("");
  const [countries, setCountries] = useState("in");
  const [result, setResult] = useState<AddBoardsResult | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () =>
    startTransition(async () => {
      const response = await addJobBoardsFromLinks({ links, countries });
      if (!response.ok) return toast(response.error);
      setResult(response.data);
      // What was added or is already there needn't be pasted again.
      const done = new Set(response.data.results.filter((entry) => entry.kind === "added" || entry.kind === "exists").map((entry) => boardKey(entry.board)));
      if (done.size > 0)
        setLinks((current) =>
          current
            .split(/\r?\n/)
            .filter((line) => {
              const board = parseBoardLink(line);
              return !board || !done.has(boardKey(board));
            })
            .join("\n"),
        );
      router.refresh();
    });

  return (
    <form
      aria-label="Add job boards"
      className="flex flex-col gap-3 rounded-card border border-line-card bg-card px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && links.trim()) add();
      }}
    >
      <Textarea
        label="Careers links"
        hint={`One per line, up to ${MAX_LINKS_PER_PASTE} at a time, optionally with the company's name first: "Razorpay, https://jobs.lever.co/razorpay". Greenhouse, Lever, Ashby, SmartRecruiters and BambooHR boards only.`}
        rows={5}
        value={links}
        onChange={(event) => setLinks(event.target.value)}
      />
      <Input label="Countries" hint="ISO codes, e.g. in or in, sg. Jobs elsewhere aren't kept." value={countries} onChange={(event) => setCountries(event.target.value)} className="max-w-[240px]" />
      <div>
        <Button type="submit" size="sm" aria-disabled={pending || !links.trim() || undefined}>
          {pending ? "Checking the boards…" : "Check and add"}
        </Button>
      </div>
      {result ? (
        <div role="status" className="flex flex-col gap-1 text-meta">
          {result.results.map((entry) => (
            <p key={`${entry.board.system}:${entry.board.boardToken}`} className={entry.kind === "added" ? "text-ink" : "text-muted"}>
              {outcomeText(entry)}
            </p>
          ))}
          {result.overLimit > 0 ? <p className="text-muted">{result.overLimit} more weren&apos;t checked: add them in another paste.</p> : null}
          {result.unread.length > 0 ? <p className="text-warning">Not a board this can read: {result.unread.join("; ")}</p> : null}
        </div>
      ) : null}
    </form>
  );
}

/** Pause or resume one board. */
export function BoardSwitch({ id, name, active }: { id: string; name: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="text"
      size="sm"
      disabled={pending}
      aria-label={`${active ? "Pause" : "Resume"} ${name}`}
      onClick={() =>
        startTransition(async () => {
          const result = await switchJobBoard({ id, active: !active });
          if (!result.ok) return toast(result.error);
          if (result.toast) toast(result.toast);
          router.refresh();
        })
      }
    >
      {active ? "Pause" : "Resume"}
    </Button>
  );
}

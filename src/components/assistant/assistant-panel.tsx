"use client";

import { ArrowRight, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";

import { askAssistant } from "@/app/(app)/assistant/actions";
import { buttonClassName } from "@/components/ui/button";
import { destinationLabel } from "@/lib/assistant/assistant";
import { cn } from "@/lib/cn";

// Pathfinder: the site-wide assistant panel (Phase 1). A button in the corner opens a chat on the
// right; the student asks about Pathfinder and gets an answer, sometimes with a link to the right
// screen. It changes nothing yet (see assistant.ts); later phases add actions behind a confirmation.

type Message = { role: "user" | "assistant"; content: string; navigate?: string | null; error?: boolean; intro?: boolean };

const GREETING: Message = {
  role: "assistant",
  intro: true,
  content: "Hi! I'm the Pathfinder assistant. Ask me how something works, or where to go — like “how do I make my resume one page?” or “where are my applications?”.",
};

export function AssistantPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const threadEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    // Optional call: jsdom (tests) doesn't implement scrollIntoView.
    threadEnd.current?.scrollIntoView?.({ block: "end" });
  }, [messages, open]);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    const history: Message[] = [...messages.filter((message) => !message.error), { role: "user", content: text }];
    setMessages(history);
    setInput("");
    startTransition(async () => {
      // The canned greeting isn't real conversation, so it isn't sent to the model.
      const forServer = history.filter((message) => !message.error && !message.intro).map(({ role, content }) => ({ role, content }));
      const result = await askAssistant({ messages: forServer, path: pathname });
      setMessages((current) =>
        result.ok
          ? [...current, { role: "assistant", content: result.data.text, navigate: result.data.navigate }]
          : [...current, { role: "assistant", content: result.error, error: true }],
      );
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the assistant"
          className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-on-primary shadow-dialog hover:opacity-95"
        >
          <Sparkles className="size-5" aria-hidden />
          Assistant
        </button>
      )}

      {open && (
        <aside
          aria-label="Pathfinder assistant"
          className="fixed inset-0 z-50 flex flex-col bg-surface shadow-dialog sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[400px] sm:border-l sm:border-line"
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <span className="flex items-center gap-2 font-medium">
              <Sparkles className="size-5 text-primary-text" aria-hidden />
              Assistant
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the assistant" className="rounded-control p-1 text-muted hover:text-ink">
              <X className="size-5" aria-hidden />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-5">
            {messages.map((message, index) => (
              <div key={index} className={cn("flex flex-col gap-2", message.role === "user" ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-card px-3.5 py-2.5 text-sm text-pretty whitespace-pre-wrap",
                    message.role === "user"
                      ? "bg-primary text-on-primary"
                      : message.error
                        ? "bg-warning-surface text-warning"
                        : "bg-card text-ink",
                  )}
                >
                  {message.content}
                </div>
                {message.navigate && (
                  <Link href={message.navigate} onClick={() => setOpen(false)} className={buttonClassName("secondary", "sm")}>
                    Open {destinationLabel(message.navigate)}
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                )}
              </div>
            ))}
            {pending && (
              <p className="text-sm text-muted" role="status">
                Thinking…
              </p>
            )}
            <div ref={threadEnd} />
          </div>

          <form onSubmit={send} className="border-t border-line p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Ask about Pathfinder…"
                aria-label="Message the assistant"
                className="max-h-32 min-h-10 flex-1 resize-none rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-line-control focus:outline-none"
              />
              <button type="submit" disabled={pending || !input.trim()} className={buttonClassName("primary", "md")}>
                Send
              </button>
            </div>
            <p className="mt-2 text-meta text-faint">The assistant can explain Pathfinder and point you to the right screen. It can’t change anything for you yet.</p>
          </form>
        </aside>
      )}
    </>
  );
}

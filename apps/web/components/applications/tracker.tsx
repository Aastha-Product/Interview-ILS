"use client";

import type { ApplicationSummary } from "@pathfinder/core";
import Link from "next/link";
import { useState } from "react";
import { Alert } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api";
import { formatDay, STATUS_LABELS, STATUS_STYLES, STATUSES, type Status } from "@/lib/applications";

export function Tracker({ initial }: { initial: ApplicationSummary[] }) {
  const [apps, setApps] = useState(initial);
  const [view, setView] = useState<"board" | "table">("board");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  async function move(id: string, status: Status) {
    const before = apps;
    const app = apps.find((a) => a.id === id);
    if (!app || app.status === status) return;
    setError(null);
    setApps((list) => list.map((a) => (a.id === id ? { ...a, status } : a))); // optimistic
    try {
      const updated = await api<{ status: Status; appliedAt: string | null; responseAt: string | null }>(`/api/applications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setApps((list) =>
        list.map((a) => (a.id === id ? { ...a, status: updated.status, appliedAt: updated.appliedAt, responseAt: updated.responseAt } : a)),
      );
      setAnnounce(`${app.title} at ${app.company} moved to ${STATUS_LABELS[status]}.`);
    } catch (e) {
      setApps(before);
      setError(e instanceof ApiRequestError ? e.message : "Couldn't change the status. Please try again.");
    }
  }

  const statusSelect = (a: ApplicationSummary) => (
    <select
      aria-label={`Status of ${a.title} at ${a.company}`}
      className="h-8 rounded-md border border-slate-300 bg-white px-1.5 text-xs"
      value={a.status}
      onChange={(e) => move(a.id, e.target.value as Status)}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );

  if (apps.length === 0) {
    return (
      <p className="text-slate-600">
        No applications yet. Find a job on the <Link href="/jobs" className="text-brand-700 underline">Jobs</Link> page and press
        &quot;Start application&quot;.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Tracker view" className="flex gap-1 self-start rounded-md border border-slate-200 bg-white p-1">
        {(["board", "table"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={`rounded px-3 py-1.5 text-sm ${view === v ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            onClick={() => setView(v)}
          >
            {v === "board" ? "Board" : "Table"}
          </button>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STATUSES.map((status) => {
            const items = apps.filter((a) => a.status === status);
            return (
              <section
                key={status}
                aria-label={`${STATUS_LABELS[status]} (${items.length})`}
                className={`flex w-60 shrink-0 flex-col gap-2 rounded-lg border p-2 ${over === status ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-slate-100/60"}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(status);
                }}
                onDragLeave={() => setOver((o) => (o === status ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData("text/plain") || dragging;
                  if (id) void move(id, status);
                }}
              >
                <h2 className="flex items-center justify-between px-1 text-sm font-semibold text-slate-700">
                  {STATUS_LABELS[status]}
                  <span className="rounded-full bg-white px-2 text-xs text-slate-500">{items.length}</span>
                </h2>
                {items.map((a) => (
                  <article
                    key={a.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", a.id);
                      setDragging(a.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={`cursor-grab rounded-md border border-slate-200 bg-white p-3 shadow-sm ${dragging === a.id ? "opacity-50" : ""}`}
                  >
                    <h3 className="text-sm font-semibold leading-snug">
                      <Link href={`/applications/${a.id}`} className="hover:underline">
                        {a.title}
                      </Link>
                    </h3>
                    <p className="text-xs text-slate-600">{a.company}</p>
                    <p className="mt-1 text-xs text-slate-500">{a.appliedAt ? `Applied ${formatDay(a.appliedAt)}` : a.hasDraft ? "Draft ready" : "Drafting…"}</p>
                    <div className="mt-2">{statusSelect(a)}</div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Role</th>
                <th scope="col" className="px-4 py-2">Company</th>
                <th scope="col" className="px-4 py-2">Status</th>
                <th scope="col" className="px-4 py-2">Applied</th>
                <th scope="col" className="px-4 py-2">Response</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <Link href={`/applications/${a.id}`} className="font-medium hover:underline">
                      {a.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{a.company}</td>
                  <td className="px-4 py-2">
                    <span className={`mr-2 hidden rounded-full px-2 py-0.5 text-xs sm:inline ${STATUS_STYLES[a.status]}`}>{STATUS_LABELS[a.status]}</span>
                    {statusSelect(a)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{formatDay(a.appliedAt)}</td>
                  <td className="px-4 py-2 text-slate-600">{formatDay(a.responseAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

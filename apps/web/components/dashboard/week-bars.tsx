"use client";

import { useState } from "react";

export interface WeekBar {
  weekStart: string;
  value: number | null;
  /** Shown in the tooltip and the bar's accessible name. */
  detail: string;
}

const weekLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

const FORMATS = {
  count: (v: number) => String(v),
  percent: (v: number) => `${Math.round(v * 100)}%`,
};

/**
 * A single-series weekly bar chart: thin bars anchored to the baseline with 4px rounded tops,
 * a recessive baseline, the latest value labelled directly, and a tooltip on hover or focus.
 * The weekly table below the charts is the accessible alternative.
 */
export function WeekBars({ title, bars, max, format: formatName }: { title: string; bars: WeekBar[]; max: number; format: keyof typeof FORMATS }) {
  const format = FORMATS[formatName];
  const [active, setActive] = useState<number | null>(null);
  const top = Math.max(max, 1);
  const lastIndex = bars.length - 1;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-slate-700">{title}</figcaption>
      <div className="relative">
        <div className="flex h-36 items-end gap-[2px] border-b border-slate-300 pt-6" role="list" aria-label={title}>
          {bars.map((b, i) => {
            const height = b.value === null ? 0 : Math.max((b.value / top) * 100, b.value > 0 ? 3 : 0);
            return (
              <div
                key={b.weekStart}
                role="listitem"
                tabIndex={0}
                aria-label={`Week of ${weekLabel(b.weekStart)}: ${b.detail}`}
                className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <div
                  className={`w-full max-w-6 rounded-t-[4px] ${active === i ? "bg-brand-700" : "bg-brand-600"}`}
                  style={{ height: `${height}%` }}
                />
                {i === lastIndex && b.value !== null && active === null && (
                  <span className="absolute text-xs font-medium text-slate-700" style={{ bottom: `calc(${height}% + 4px)` }}>
                    {format(b.value)}
                  </span>
                )}
                {active === i && (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow">
                    <div className="font-medium">Week of {weekLabel(b.weekStart)}</div>
                    <div>{b.detail}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-[2px] text-[11px] text-slate-500">
          {bars.map((b, i) => (
            <span key={b.weekStart} className="flex-1 text-center tabular-nums">
              {i % 2 === lastIndex % 2 ? weekLabel(b.weekStart) : ""}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

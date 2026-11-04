"use client";

import { profileStrength } from "@pathfinder/core/profile-strength";
import type { ProfileInput } from "@pathfinder/core/profile";
import { Progress } from "radix-ui";

export function StrengthMeter({ profile }: { profile: ProfileInput }) {
  const { score, label, tips } = profileStrength(profile);
  const color = score >= 75 ? "bg-green-600" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-slate-700">Profile strength</p>
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{score}</span>/100 · {label}
        </p>
      </div>
      <Progress.Root
        value={score}
        aria-label="Profile strength"
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <Progress.Indicator className={`h-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </Progress.Root>
      {tips.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

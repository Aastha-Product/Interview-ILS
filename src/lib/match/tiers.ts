import type { MatchTier } from "@/generated/prisma/enums";

// Pathfinder (auto-apply step 3): the AI's 0–100 fit score as the four groups students see.
// Auto-apply (step 4) applies from Strong and Good by default; Partial and Not recommended are
// kept with their reasons so a student can see why.

export const TIER_FLOORS = { STRONG: 80, GOOD: 65, PARTIAL: 50 } as const;

export function tierFor(score: number): MatchTier {
  if (score >= TIER_FLOORS.STRONG) return "STRONG";
  if (score >= TIER_FLOORS.GOOD) return "GOOD";
  if (score >= TIER_FLOORS.PARTIAL) return "PARTIAL";
  return "NOT_RECOMMENDED";
}

export const TIER_LABELS: Record<MatchTier, string> = {
  STRONG: "Strong match",
  GOOD: "Good match",
  PARTIAL: "Partial match",
  NOT_RECOMMENDED: "Not recommended",
};

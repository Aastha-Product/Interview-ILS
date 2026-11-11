import { MIN_RESUME_SCALE } from "@/lib/settings";

// Pathfinder: fitting the base resume onto one page. The resume lays out in page units, so a
// smaller scale is never taller (document-page.tsx scales spacing and text, not the paper). The
// preview therefore starts at full size and steps the scale down until it measures a single page:
// the first scale that fits is the largest one that does.

/** How much the scale drops each step while fitting; small enough to land close to the largest fit. */
export const FIT_STEP = 0.02;

/** Scales as whole percentages for the manual control, from full size down to the smallest allowed. */
export const SCALE_PERCENTS = Array.from(
  { length: Math.round((1 - MIN_RESUME_SCALE) / FIT_STEP) + 1 },
  (_, index) => Math.round((1 - index * FIT_STEP) * 100),
);

/** A scale as a whole-percent label, e.g. 0.9 → "90%". */
export const scalePercent = (scale: number): string => `${Math.round(scale * 100)}%`;

/**
 * The next scale to try while fitting the resume to one page, or null when there's nothing more to
 * do — it already fits one page, or it's as small as allowed. Stepping down from the current scale,
 * the caller stops at the first scale that measures one page, which is the largest that fits.
 */
export function nextFitScale(pages: number, scale: number, { step = FIT_STEP, min = MIN_RESUME_SCALE } = {}): number | null {
  if (pages <= 1 || scale <= min) return null;
  return Math.max(min, Math.round((scale - step) * 100) / 100);
}

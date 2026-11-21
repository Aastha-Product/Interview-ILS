// Pathfinder MVP rule: the job list only shows postings worth acting on. A posting
// scoring below ACTIONABLE_MIN_SCORE is dropped, and so is one with no link to apply
// through. A student may set a higher minimum in Settings, never a lower one.

export const ACTIONABLE_MIN_SCORE = 80;

/** The minimum a posting needs to be kept: the student's setting, but never below the floor. */
export function actionableMinScore(setting: number): number {
  return Math.max(setting, ACTIONABLE_MIN_SCORE);
}

/** Whether a scored posting is worth showing: it clears the minimum and has a link. */
export function isActionable(posting: { score: number; url: string }, minimum: number): boolean {
  return posting.score >= minimum && posting.url.trim() !== "";
}

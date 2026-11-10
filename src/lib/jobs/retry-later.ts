/**
 * Pathfinder: thrown by a job to say "not now, later": a job board's quota is used up until a
 * reset, or a shared rate limit (src/lib/jobs/rate-limit.ts) needs a longer wait than is worth
 * holding a worker for. The job runs again after `afterMs` if it has attempts left.
 */
export class RetryLater extends Error {
  override name = "RetryLater";

  constructor(
    /** For the student while it waits, and as the failure if no attempts are left. */
    message: string,
    readonly afterMs?: number,
  ) {
    super(message);
  }
}

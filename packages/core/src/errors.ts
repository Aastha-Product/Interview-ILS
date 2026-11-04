/** An error whose message is safe and helpful to show to a student. */
export class UserFacingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
    /** For 429 responses: when the student may try again. */
    readonly retryAfterSeconds?: number,
    /** Safe, non-personal extra data for the UI (e.g. the id of an existing application). */
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

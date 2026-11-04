/** An error whose message is safe and helpful to show to a student. */
export class UserFacingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

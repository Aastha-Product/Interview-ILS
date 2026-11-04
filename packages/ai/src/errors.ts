import type { AiOutcome } from "./types";

/** An AI call failure. `kind` decides whether it is worth retrying. */
export class AiError extends Error {
  constructor(
    readonly kind: Exclude<AiOutcome, "ok">,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }

  get retryable(): boolean {
    return this.kind !== "bad_request";
  }
}

/** Maps provider/SDK errors onto AiError without copying their messages (they can echo input). */
export function classifyError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : undefined;
  if (status === 429) return new AiError("rate_limited", "The AI service is busy", status);
  if (status !== undefined && status >= 500) return new AiError("server_error", "The AI service failed", status);
  if (status !== undefined && status >= 400) return new AiError("bad_request", "The AI service rejected the request", status);
  if (error instanceof Error && error.name === "AbortError") return new AiError("timeout", "The AI call timed out");
  return new AiError("network_error", "Could not reach the AI service");
}

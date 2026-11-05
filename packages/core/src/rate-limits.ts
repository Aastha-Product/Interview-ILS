import { hitRateLimit } from "@pathfinder/db";
import { getConfig, type ServerConfig } from "./config";
import { UserFacingError } from "./errors";

type LimitConfig = Pick<ServerConfig, "RATE_LIMIT_API_PER_MINUTE" | "RATE_LIMIT_SIGNIN_PER_MINUTE">;

/**
 * API requests per signed-in student (brief §7: 60 a minute). Throws a 429 with Retry-After and a
 * plain-English message when the student goes over.
 */
export async function enforceApiLimit(userId: string, options: { config?: LimitConfig; now?: Date } = {}): Promise<void> {
  const config = options.config ?? getConfig();
  const result = await hitRateLimit(`api:${userId}`, { limit: config.RATE_LIMIT_API_PER_MINUTE, windowSeconds: 60, now: options.now });
  if (!result.allowed) {
    throw new UserFacingError(
      "RATE_LIMITED",
      "You're going a little fast. Please wait a few seconds and try again.",
      429,
      result.retryAfterSeconds,
    );
  }
}

/**
 * Sign-in attempts per IP (brief §7: 10 a minute). Keyed by the keyed hash of the IP, never the
 * address itself. Requests with no IP information share one bucket.
 * Returns the seconds to wait, or null when the attempt is allowed.
 */
export async function checkSignInLimit(
  ipHash: string | null,
  options: { config?: LimitConfig; now?: Date } = {},
): Promise<number | null> {
  const config = options.config ?? getConfig();
  const result = await hitRateLimit(`signin:${ipHash ?? "unknown"}`, {
    limit: config.RATE_LIMIT_SIGNIN_PER_MINUTE,
    windowSeconds: 60,
    now: options.now,
  });
  return result.allowed ? null : result.retryAfterSeconds;
}

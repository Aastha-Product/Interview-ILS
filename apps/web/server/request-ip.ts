import { getConfig, hashIp } from "@pathfinder/core";

/** Hashed client IP for the audit log. The raw address is never stored. */
export function ipHashFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip") || null;
  return hashIp(ip, getConfig().AUTH_SECRET);
}

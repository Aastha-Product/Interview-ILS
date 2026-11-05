import { getConfig, hashIp } from "@pathfinder/core";

/**
 * The client's IP as seen by the trusted proxies in front of the app. Each proxy appends the
 * address it received the request from to X-Forwarded-For, so the entry `trustedHops` from the
 * right is the real client; anything further left was sent by the client and can be forged.
 * With 0 trusted hops (no proxy, e.g. local development) the header is ignored.
 */
export function clientIpFrom(headers: Headers, trustedHops: number): string | null {
  if (trustedHops <= 0) return null;
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return entries[entries.length - trustedHops] ?? null;
}

/** Keyed hash of the client IP, for the audit log and the sign-in limit. The address is never stored. */
export function ipHashFrom(headers: Headers): string | null {
  const config = getConfig();
  return hashIp(clientIpFrom(headers, config.TRUSTED_PROXY_HOPS), config.AUTH_SECRET);
}

import "server-only";

import { notFound } from "next/navigation";

import { env } from "@/lib/env";

// Pathfinder: Startups (#222) is off unless PATHFINDER_STARTUPS=on. It reads
// YC's job pages, Hacker News and startups' own sites, and Pathfinder's jobs
// come only from licensed APIs or what the student pastes. The code stays, so
// a server can turn it back on.

/** Whether this server offers Startups. */
export function startupsEnabled(): boolean {
  return env.PATHFINDER_STARTUPS === "on";
}

/** Answers 404 while Startups is off: for its pages and actions. */
export function requireStartups(): void {
  if (!startupsEnabled()) notFound();
}

/** Thrown by its background work while Startups is off, e.g. for a refresh queued before it was turned off. */
export class StartupsOffError extends Error {
  override name = "StartupsOffError";
  constructor() {
    super("Startups is off on this server (PATHFINDER_STARTUPS).");
  }
}

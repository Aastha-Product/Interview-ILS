import type { BoardSystem } from "@/generated/prisma/enums";

// Phase 2 (reach): adding job boards from Admin → Job boards. An admin pastes a company's
// careers-page links, one per line, optionally with the company's name before a comma
// ("Razorpay, https://jobs.lever.co/razorpay"); each is read here into the board the crawler
// asks. Only the four boards the crawler reads, through their public APIs.

export type BoardLink = { system: BoardSystem; boardToken: string; name: string };

/** Each system as the admin console names it. */
export const SYSTEM_NAMES: Record<BoardSystem, string> = { GREENHOUSE: "Greenhouse", LEVER: "Lever", ASHBY: "Ashby", SMARTRECRUITERS: "SmartRecruiters" };

/** The most boards one paste adds: each is checked live first, so a paste stays quick. */
export const MAX_LINKS_PER_PASTE = 25;

// The board's name in each system's careers addresses. Lever's EU boards use another API, which
// the crawler doesn't ask, so jobs.eu.lever.co isn't accepted.
const PATTERNS: readonly { system: BoardSystem; host: RegExp; token: (url: URL) => string | null }[] = [
  {
    system: "GREENHOUSE",
    host: /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/,
    // boards.greenhouse.io/embed/job_board?for=<token> is the embedded board.
    token: (url) => url.searchParams.get("for") ?? firstSegment(url, ["embed"]),
  },
  { system: "LEVER", host: /^jobs\.lever\.co$/, token: (url) => firstSegment(url) },
  { system: "ASHBY", host: /^jobs\.ashbyhq\.com$/, token: (url) => firstSegment(url) },
  { system: "SMARTRECRUITERS", host: /^(jobs|careers)\.smartrecruiters\.com$/, token: (url) => firstSegment(url) },
];

function firstSegment(url: URL, skip: readonly string[] = []): string | null {
  const segment = url.pathname.split("/").filter(Boolean)[0];
  return segment && !skip.includes(segment) ? segment : null;
}

/** "sumo-logic" → "Sumo Logic": a name from the board's, when the admin didn't give one. */
export function nameFromToken(token: string): string {
  return token
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** One pasted line read as a board, or null when it isn't one of the four. */
export function parseBoardLink(line: string): BoardLink | null {
  const text = line.trim();
  if (!text) return null;
  const match = /^(?:(.+?),\s*)?(\S+)$/.exec(text);
  if (!match) return null;
  const [, givenName, address] = match;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const pattern of PATTERNS) {
    if (!pattern.host.test(host)) continue;
    const raw = pattern.token(url);
    if (!raw || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw)) return null;
    // SmartRecruiters company ids are case-sensitive; the others aren't.
    const boardToken = pattern.system === "SMARTRECRUITERS" ? raw : raw.toLowerCase();
    return { system: pattern.system, boardToken, name: givenName?.trim().slice(0, 100) || nameFromToken(boardToken) };
  }
  return null;
}

/** A paste read line by line: the boards, each once, and the lines that weren't one. */
export function parseBoardLinks(text: string): { boards: BoardLink[]; unread: string[] } {
  const boards: BoardLink[] = [];
  const unread: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const board = parseBoardLink(line);
    if (!board) {
      unread.push(line.trim().slice(0, 200));
      continue;
    }
    const key = `${board.system}:${board.boardToken.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    boards.push(board);
  }
  return { boards, unread };
}

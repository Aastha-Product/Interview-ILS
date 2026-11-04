import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";
import { UserFacingError } from "../errors";

/**
 * Fetches the ONE job page a student pasted, at their request. This is not a crawler:
 * - http(s) on ports 80/443 only, at most 3 redirects, 2 MB, 10 seconds;
 * - every DNS answer is checked at connect time, so private, loopback and cloud-metadata
 *   addresses are refused even after redirects or DNS rebinding;
 * - robots.txt is honoured for our user agent; if a site says no, the student pastes the text.
 */

export const USER_AGENT_TOKEN = "PathfinderBot";
const MAX_REDIRECTS = 3;

export interface FetchedPage {
  finalUrl: string;
  contentType: string;
  body: string;
}

export interface FetchPageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Used in the User-Agent header so site owners can see who we are. */
  appUrl?: string;
  /** Tests only: allow 127.0.0.1 so a local test server can be used. Refused in production. */
  allowLoopbackForTests?: boolean;
}

export class PageFetchError extends Error {
  constructor(
    readonly kind: "blocked_address" | "bad_url" | "robots" | "http" | "too_large" | "timeout" | "network" | "content_type",
    message: string,
  ) {
    super(message);
    this.name = "PageFetchError";
  }
}

// ---------- address checks ----------

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** True only for addresses on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToInt(address);
    return !BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const a = address.toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (a === "::" || a === "::1") return false;
    const first = parseInt(a.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (a.startsWith("64:ff9b:") || a.startsWith("2001:db8:") || a.startsWith("2002:")) return false;
    return true;
  }
  return false;
}

const testMode = (opts: FetchPageOptions) => opts.allowLoopbackForTests === true && process.env.NODE_ENV !== "production";

function checkUrl(raw: string, allowAnyPort = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PageFetchError("bad_url", "Not a valid web address");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PageFetchError("bad_url", "Only web links are supported");
  if (url.username || url.password) throw new PageFetchError("bad_url", "Links with passwords are not supported");
  if (url.port && url.port !== "80" && url.port !== "443" && !allowAnyPort) throw new PageFetchError("bad_url", "Unusual port");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new PageFetchError("blocked_address", "Private address");
  }
  return url;
}

// ---------- low-level request ----------

function request(url: URL, opts: Required<Pick<FetchPageOptions, "timeoutMs" | "maxBytes">> & FetchPageOptions, accept: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const allowLoopback = testMode(opts);
    // Validate every address the connection could use, at connect time.
    const safeLookup = (
      hostname: string,
      options: { all?: boolean },
      callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
    ) => {
      dnsLookup(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err, "", 0);
        const ok = addresses.filter((a) => isPublicAddress(a.address) || (allowLoopback && a.address === "127.0.0.1"));
        if (ok.length === 0 || ok.length !== addresses.length) {
          return callback(new PageFetchError("blocked_address", "Private address"), "", 0);
        }
        if (options.all) return callback(null, ok);
        callback(null, ok[0]!.address, ok[0]!.family);
      });
    };
    if (isIP(url.hostname) && !(isPublicAddress(url.hostname) || (allowLoopback && url.hostname === "127.0.0.1"))) {
      return reject(new PageFetchError("blocked_address", "Private address"));
    }

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: safeLookup as never,
        headers: {
          "User-Agent": `Mozilla/5.0 (compatible; ${USER_AGENT_TOKEN}/0.1; +${opts.appUrl ?? "https://pathfinder.example"})`,
          Accept: accept,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-IN,en;q=0.8",
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip"
            ? res.pipe(zlib.createGunzip())
            : encoding === "deflate"
              ? res.pipe(zlib.createInflate())
              : encoding === "br"
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            req.destroy(new PageFetchError("too_large", "Page too large"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        stream.on("error", reject);
      },
    );
    const deadline = setTimeout(() => req.destroy(new PageFetchError("timeout", "Timed out")), opts.timeoutMs);
    req.on("timeout", () => req.destroy(new PageFetchError("timeout", "Timed out")));
    req.on("error", (err) => {
      clearTimeout(deadline);
      reject(err instanceof PageFetchError ? err : new PageFetchError("network", "Could not connect"));
    });
    req.on("close", () => clearTimeout(deadline));
    req.end();
  });
}

async function getFollowingRedirects(
  start: URL,
  opts: Required<Pick<FetchPageOptions, "timeoutMs" | "maxBytes">> & FetchPageOptions,
  accept: string,
) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await request(url, opts, accept);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = checkUrl(new URL(res.headers.location, url).toString(), testMode(opts));
      continue;
    }
    return { url, ...res };
  }
  throw new PageFetchError("http", "Too many redirects");
}

// ---------- robots.txt ----------

interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (key === "disallow" && value === "") continue; // "Disallow:" with no path allows everything
      current.rules.push({ allow: key === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith("$");
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}

/** Standard robots.txt matching: our own group if present, else "*"; the longest matching rule wins, Allow wins ties. */
export function isAllowedByRobots(robotsText: string, pathWithQuery: string, agentToken = USER_AGENT_TOKEN): boolean {
  const groups = parseRobots(robotsText);
  const token = agentToken.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of group.rules) {
    if (!ruleMatches(rule.path, pathWithQuery)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best?.allow ?? true;
}

// ---------- public entry point ----------

export async function fetchJobPage(rawUrl: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  const opts = { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024, ...options };
  const url = checkUrl(rawUrl, testMode(opts));

  // robots.txt: missing (4xx) means allowed; an error or 5xx means we don't fetch.
  const robotsUrl = new URL("/robots.txt", url);
  let robots: Awaited<ReturnType<typeof getFollowingRedirects>> | null = null;
  try {
    robots = await getFollowingRedirects(robotsUrl, { ...opts, maxBytes: 512 * 1024, timeoutMs: 5_000 }, "text/plain");
  } catch (error) {
    if (error instanceof PageFetchError && error.kind === "blocked_address") throw error;
    throw new PageFetchError("robots", "Could not check robots.txt");
  }
  if (robots.status >= 500) throw new PageFetchError("robots", "robots.txt unavailable");
  if (robots.status >= 200 && robots.status < 300) {
    if (!isAllowedByRobots(robots.body.toString("utf8"), `${url.pathname}${url.search}`)) {
      throw new PageFetchError("robots", "Disallowed by robots.txt");
    }
  }

  const page = await getFollowingRedirects(url, opts, "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5");
  if (page.status < 200 || page.status >= 300) throw new PageFetchError("http", `HTTP ${page.status}`);
  const contentType = String(page.headers["content-type"] ?? "").toLowerCase();
  if (!/text\/html|application\/xhtml\+xml|text\/plain/.test(contentType)) {
    throw new PageFetchError("content_type", "Not a web page");
  }
  const charset = contentType.match(/charset=([\w-]+)/)?.[1] ?? "utf-8";
  let body: string;
  try {
    body = new TextDecoder(charset).decode(page.body);
  } catch {
    body = page.body.toString("utf8");
  }
  return { finalUrl: page.url.toString(), contentType, body };
}

/** Turns a fetch failure into the message the student sees, always offering the paste route. */
export function pageFetchErrorToUserError(error: unknown): UserFacingError {
  const kind = error instanceof PageFetchError ? error.kind : "network";
  const messages: Record<string, string> = {
    bad_url: "That doesn't look like a job link. Check the address, or paste the job description instead.",
    blocked_address: "We can't open that address. Paste the job description instead.",
    robots: "This site asks automated tools not to read its pages, so we won't fetch it. Copy the job description from the page and paste it here.",
    http: "That page didn't open (it may have closed or need you to sign in). Copy the job description and paste it here.",
    too_large: "That page is too large to read. Copy the job description and paste it here.",
    timeout: "That page took too long to load. Copy the job description and paste it here.",
    content_type: "That link isn't a web page. Copy the job description and paste it here.",
    network: "We couldn't reach that site. Copy the job description and paste it here.",
  };
  return new UserFacingError("NEEDS_TEXT", messages[kind] ?? messages.network!, 422);
}

const BASE = "http://dossier.invalid";

/** Where signing in lands without a `next`: the resume analysis (Pathfinder's home). */
export const HOME_PATH = "/analyze";

/**
 * Where to go after signing in: `next` when it's a page of this app (other
 * than /login), otherwise the resume analysis. Anything that could leave the site,
 * such as "//evil.example" or "https://evil.example", is ignored.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next?.startsWith("/")) return HOME_PATH;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== BASE) return HOME_PATH;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return HOME_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}

// Phase 5 (public pages): the open jobs board, for visitors who aren't signed in. It lists the
// jobs the crawler keeps from companies' public job boards (job ads aren't personal), with a link
// to each on the company's own board and an invitation to let Pathfinder apply. Nothing about any
// student is read or shown.

/** Jobs a page. */
export const PUBLIC_PAGE_SIZE = 25;
/** The deepest page served: enough to browse, not a way to copy the whole pool. */
export const PUBLIC_MAX_PAGE = 40;
/** Longest search a visitor may type. */
const MAX_TERM = 80;

export type PublicJobsQuery = { q: string; city: string; remote: boolean; page: number };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const term = (value: string | string[] | undefined) => one(value).replace(/\s+/g, " ").trim().slice(0, MAX_TERM);

/** The board's search from its address (?q=&city=&remote=1&page=), cleaned. */
export function parsePublicJobsQuery(params: Record<string, string | string[] | undefined>): PublicJobsQuery {
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: term(params.q),
    city: term(params.city),
    remote: one(params.remote) === "1",
    page: Number.isFinite(page) ? Math.min(Math.max(page, 1), PUBLIC_MAX_PAGE) : 1,
  };
}

/** The address of a page of results, keeping the search; empty parts left out. */
export function publicJobsHref(query: PublicJobsQuery, page = query.page): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.city) params.set("city", query.city);
  if (query.remote) params.set("remote", "1");
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/open-jobs?${search}` : "/open-jobs";
}

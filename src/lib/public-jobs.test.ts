import { describe, expect, it } from "vitest";

import { parsePublicJobsQuery, PUBLIC_MAX_PAGE, publicJobsHref, searchWords } from "./public-jobs";

describe("the open jobs board's search (Phase 5)", () => {
  it("reads the search from the address, cleaned and within limits", () => {
    expect(parsePublicJobsQuery({ q: "  data   analyst ", city: "Pune", remote: "1", page: "3" })).toEqual({ q: "data analyst", city: "Pune", remote: true, page: 3 });
    expect(parsePublicJobsQuery({})).toEqual({ q: "", city: "", remote: false, page: 1 });
    expect(parsePublicJobsQuery({ page: "0" }).page).toBe(1);
    expect(parsePublicJobsQuery({ page: "999" }).page).toBe(PUBLIC_MAX_PAGE);
    expect(parsePublicJobsQuery({ page: "abc", remote: "yes" })).toMatchObject({ page: 1, remote: false });
    expect(parsePublicJobsQuery({ q: ["one", "two"] }).q).toBe("one");
    expect(parsePublicJobsQuery({ q: "x".repeat(200) }).q).toHaveLength(80);
  });

  it("links each page of results with the same search, leaving empty parts out", () => {
    const query = { q: "SQL & Python", city: "", remote: true, page: 1 };
    expect(publicJobsHref(query)).toBe("/open-jobs?q=SQL+%26+Python&remote=1");
    expect(publicJobsHref(query, 2)).toBe("/open-jobs?q=SQL+%26+Python&remote=1&page=2");
    expect(publicJobsHref({ q: "", city: "", remote: false, page: 1 })).toBe("/open-jobs");
  });

  it("splits a search into its words, once each", () => {
    expect(searchWords(" Data  Analyst, data/SQL ")).toEqual(["data", "analyst", "sql"]);
    expect(searchWords("a b c d e f g h")).toHaveLength(6);
    expect(searchWords("   ")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { EMPTY_QUERY } from "@/lib/job-search/search";

import { agentSearches, MAX_EXTRA_SEARCHES, searchReady } from "./profiles";

const analyst = { ...EMPTY_QUERY, keywords: "Data analyst", place: "Bengaluru", country: "in" };
const business = { ...EMPTY_QUERY, keywords: "Business analyst", country: "in", remoteOnly: true };

describe("job profiles: the agent's searches (Phase 1)", () => {
  it("runs the main search first, then the others", () => {
    expect(agentSearches(analyst, [business]).map((query) => query.keywords)).toEqual(["Data analyst", "Business analyst"]);
  });

  it("leaves out a search without keywords or a country, and the same search twice", () => {
    expect(searchReady({ ...business, country: "" })).toBe(false);
    expect(agentSearches(analyst, [{ ...business, keywords: "  " }, business]).map((query) => query.keywords)).toEqual(["Data analyst", "Business analyst"]);
    expect(agentSearches(analyst, [{ ...analyst, keywords: "data ANALYST " }, business]).map((query) => query.keywords)).toEqual(["Data analyst", "Business analyst"]);
  });

  it("runs at most the main search and the extra ones allowed", () => {
    const extra = ["QA", "SRE", "PM"].map((keywords) => ({ ...business, keywords }));
    expect(agentSearches(analyst, extra)).toHaveLength(1 + MAX_EXTRA_SEARCHES);
  });

  it("still runs the extra searches when the main one isn't complete", () => {
    expect(agentSearches(EMPTY_QUERY, [business]).map((query) => query.keywords)).toEqual(["Business analyst"]);
  });
});

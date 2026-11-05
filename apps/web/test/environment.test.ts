import { describe, expect, it } from "vitest";
import { environmentNotice } from "../server/environment";

describe("environmentNotice", () => {
  it("marks staging as test-only and keeps it out of search engines", () => {
    expect(environmentNotice("staging")).toEqual({
      banner: "Staging site: test data only. Don't enter real personal information.",
      indexable: false,
    });
  });

  it("shows nothing in production, and lets it be indexed", () => {
    expect(environmentNotice("production")).toEqual({ banner: null, indexable: true });
  });

  it("keeps local development out of search engines without a banner", () => {
    expect(environmentNotice("development")).toEqual({ banner: null, indexable: false });
  });
});

import { describe, expect, it } from "vitest";

import { isToolPage } from "./tool-paths";

describe("isToolPage (Pathfinder)", () => {
  it("knows the job-search tools' pages and below", () => {
    for (const path of ["/resume", "/jobs", "/jobs/abc", "/agent", "/applications", "/applications/1/edit", "/new", "/inbox", "/inbox/t1"]) {
      expect(isToolPage(path), path).toBe(true);
    }
  });

  it("leaves the student's own pages and look-alikes alone", () => {
    for (const path of ["/", "/analyze", "/profile", "/settings", "/feedback", "/resumes", "/jobsearch", "/newsletter", "/api/jobs/1", "/print/application/1"]) {
      expect(isToolPage(path), path).toBe(false);
    }
  });
});

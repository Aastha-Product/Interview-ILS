import { describe, expect, it } from "vitest";

import { nameFromToken, parseBoardLink, parseBoardLinks } from "./board-links";

describe("reading pasted careers links (Phase 2: Admin → Job boards)", () => {
  it("reads each system's careers addresses", () => {
    expect(parseBoardLink("https://job-boards.greenhouse.io/okta")).toEqual({ system: "GREENHOUSE", boardToken: "okta", name: "Okta" });
    expect(parseBoardLink("https://boards.greenhouse.io/embed/job_board?for=sumologic")).toMatchObject({ system: "GREENHOUSE", boardToken: "sumologic" });
    expect(parseBoardLink("jobs.lever.co/Razorpay/abc-123")).toMatchObject({ system: "LEVER", boardToken: "razorpay" });
    expect(parseBoardLink("https://jobs.ashbyhq.com/atlan?departmentId=1")).toMatchObject({ system: "ASHBY", boardToken: "atlan" });
    // SmartRecruiters ids keep their case.
    expect(parseBoardLink("https://careers.smartrecruiters.com/BoschGroup")).toMatchObject({ system: "SMARTRECRUITERS", boardToken: "BoschGroup" });
  });

  it("takes a name given before a comma, else makes one from the board's", () => {
    expect(parseBoardLink("Tata 1mg, https://jobs.lever.co/1mg")).toEqual({ system: "LEVER", boardToken: "1mg", name: "Tata 1mg" });
    expect(nameFromToken("sumo-logic")).toBe("Sumo Logic");
    expect(nameFromToken("BoschGroup")).toBe("BoschGroup");
  });

  it("refuses other sites, Lever's EU boards, and addresses without a board", () => {
    expect(parseBoardLink("https://www.linkedin.com/company/okta/jobs")).toBeNull();
    expect(parseBoardLink("https://jobs.eu.lever.co/acme")).toBeNull();
    expect(parseBoardLink("https://job-boards.greenhouse.io/")).toBeNull();
    expect(parseBoardLink("not a link at all")).toBeNull();
  });

  it("reads a paste line by line, each board once, and lists the lines it couldn't read", () => {
    const { boards, unread } = parseBoardLinks(
      ["https://job-boards.greenhouse.io/okta", "", "https://boards.greenhouse.io/OKTA", "https://naukri.com/acme-jobs", "Meesho, jobs.lever.co/meesho"].join("\n"),
    );
    expect(boards.map((board) => `${board.system}:${board.boardToken}`)).toEqual(["GREENHOUSE:okta", "LEVER:meesho"]);
    expect(unread).toEqual(["https://naukri.com/acme-jobs"]);
  });
});

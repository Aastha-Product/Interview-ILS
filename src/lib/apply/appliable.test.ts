import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTENSION_HOSTS, extensionCanApply } from "./appliable";

describe("which jobs the extension can apply to (auto-apply)", () => {
  it("those on Greenhouse's, Lever's and Ashby's own forms", () => {
    expect(extensionCanApply({ system: "GREENHOUSE", url: "https://job-boards.greenhouse.io/zscaler/jobs/1", applyUrl: "https://job-boards.greenhouse.io/zscaler/jobs/1" })).toBe(true);
    expect(extensionCanApply({ system: "GREENHOUSE", url: "https://boards.greenhouse.io/figma/jobs/1?gh_jid=1", applyUrl: "https://job-boards.greenhouse.io/figma/jobs/1" })).toBe(true);
    expect(extensionCanApply({ system: "LEVER", url: "https://jobs.lever.co/meesho/1", applyUrl: "https://jobs.lever.co/meesho/1/apply" })).toBe(true);
    expect(extensionCanApply({ system: "ASHBY", url: "https://jobs.ashbyhq.com/Tekion/1", applyUrl: "https://jobs.ashbyhq.com/Tekion/1/application" })).toBe(true);
    // Greenhouse's API gave no address of its own: its form, then.
    expect(extensionCanApply({ system: "GREENHOUSE", url: "", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1" })).toBe(true);
  });

  it("not a company's own site, which Greenhouse sends its page on to, nor SmartRecruiters", () => {
    expect(extensionCanApply({ system: "GREENHOUSE", url: "https://www.okta.com/company/careers/opportunity/1?gh_jid=1", applyUrl: "https://job-boards.greenhouse.io/okta/jobs/1" })).toBe(false);
    expect(extensionCanApply({ system: "GREENHOUSE", url: "https://greenhouse.io.evil.example/1", applyUrl: "https://job-boards.greenhouse.io/x/jobs/1" })).toBe(false);
    expect(extensionCanApply({ system: "SMARTRECRUITERS", url: "https://jobs.smartrecruiters.com/Acme/1", applyUrl: "https://jobs.smartrecruiters.com/Acme/1" })).toBe(false);
    expect(extensionCanApply({ system: "LEVER", url: "", applyUrl: "not a url" })).toBe(false);
  });

  it("matches what the extension may open", () => {
    const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8")) as { host_permissions: string[] };
    for (const host of EXTENSION_HOSTS) expect(manifest.host_permissions, host).toContain(`https://${host}/*`);
  });
});

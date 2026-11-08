import { describe, expect, it } from "vitest";

import { managedSettingsSections, settingsSectionFromParam, settingsSectionHref } from "./sections";

describe("settings sections", () => {
  it("reads the section from the URL, defaulting to AI provider", () => {
    expect(settingsSectionFromParam("data")).toBe("data");
    expect(settingsSectionFromParam(undefined)).toBe("ai");
    expect(settingsSectionFromParam("nope")).toBe("ai");
    expect(settingsSectionFromParam(["about", "data"])).toBe("ai");
    // Pathfinder: the MCP connector is off on a server with many students, so its links fall back.
    expect(settingsSectionFromParam("claude")).toBe("ai");
    expect(settingsSectionFromParam("connector")).toBe("ai");
  });

  it("links to a section", () => {
    expect(settingsSectionHref("documents")).toBe("/settings?section=documents");
  });
  it("gives managed students their own sections around the tools' settings, never the service's (Pathfinder)", () => {
    const ids = (google: boolean) => managedSettingsSections(google).map((section) => section.id);
    expect(ids(true)).toEqual(["account", "plan", "agent", "documents", "google", "data", "privacy", "help"]);
    expect(ids(false)).toEqual(["account", "plan", "agent", "documents", "data", "privacy", "help"]);
    expect(settingsSectionFromParam(undefined, managedSettingsSections(false))).toBe("account");
    for (const id of ["ai", "jobs", "scoring", "about"]) expect(settingsSectionFromParam(id, managedSettingsSections(true))).toBe("account");
  });
});

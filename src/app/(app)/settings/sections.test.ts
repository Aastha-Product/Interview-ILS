import { describe, expect, it } from "vitest";

import { settingsSectionFromParam, settingsSectionHref } from "./sections";

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
});

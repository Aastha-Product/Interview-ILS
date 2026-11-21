import { describe, expect, it } from "vitest";

import { BLOCKLIST_MAX_ENTRIES, isBlocked, normalizeCompany, parseBlocklist } from "./blocklist";

describe("the company blocklist", () => {
  it("compares names without case, accents, punctuation or legal form", () => {
    expect(normalizeCompany("Infosys Ltd.")).toBe("infosys");
    expect(normalizeCompany("  Société Générale ")).toBe("societe generale");
    expect(normalizeCompany("Tata Consultancy Services Pvt. Limited")).toBe("tata consultancy services");
    expect(normalizeCompany("Ernst & Young")).toBe("ernst and young");
  });

  it("leaves out a company whose name holds an entry's words, whole", () => {
    expect(isBlocked("Infosys BPM Limited", ["Infosys"])).toBe(true);
    expect(isBlocked("INFOSYS", ["infosys ltd"])).toBe(true);
    expect(isBlocked("Ernst and Young LLP", ["Ernst & Young"])).toBe(true);
    // Part of a word isn't a match.
    expect(isBlocked("Infosystems Inc", ["Infosys"])).toBe(false);
    expect(isBlocked("Metacube", ["Meta"])).toBe(false);
  });

  it("blocks nothing for an empty list, an empty entry, or a posting with no company", () => {
    expect(isBlocked("Infosys", [])).toBe(false);
    expect(isBlocked("Infosys", ["", "  ", "Ltd"])).toBe(false);
    expect(isBlocked("", ["Infosys"])).toBe(false);
  });

  it("reads one company per line or comma, each once, in order", () => {
    expect(parseBlocklist("Infosys\n  TCS , Wipro\n\ninfosys ltd\nWipro")).toEqual(["Infosys", "TCS", "Wipro"]);
    expect(parseBlocklist("")).toEqual([]);
  });

  it("keeps at most the limit", () => {
    const many = Array.from({ length: BLOCKLIST_MAX_ENTRIES + 5 }, (_, index) => `Company ${index}`).join("\n");
    expect(parseBlocklist(many)).toHaveLength(BLOCKLIST_MAX_ENTRIES);
  });
});

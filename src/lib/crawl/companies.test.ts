import { describe, expect, it } from "vitest";

import { BoardSystem } from "@/generated/prisma/enums";

import { ADAPTERS } from "./adapters";
import { STARTER_COMPANIES } from "./companies";

describe("the crawler's companies and boards (auto-apply step 2)", () => {
  it("has an adapter for every board system, under its own name", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(Object.values(BoardSystem).sort());
    for (const [system, adapter] of Object.entries(ADAPTERS)) expect(adapter.system).toBe(system);
  });

  it("starts with companies that are each listed once, with a board name and a country code", () => {
    const keys = STARTER_COMPANIES.map((company) => `${company.system}:${company.boardToken.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const company of STARTER_COMPANIES) {
      expect(company.name.trim()).not.toBe("");
      expect(company.boardToken).toMatch(/^[A-Za-z0-9_-]+$/);
      for (const country of company.countries ?? ["in"]) expect(country).toMatch(/^[a-z]{2}$/);
    }
  });
});

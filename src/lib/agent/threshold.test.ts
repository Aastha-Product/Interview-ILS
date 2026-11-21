import { describe, expect, it } from "vitest";

import { actionableMinScore, isActionable } from "./threshold";

describe("the job list's MVP rule", () => {
  it("never lets the minimum go below 80, but lets a student set it higher", () => {
    expect(actionableMinScore(50)).toBe(80);
    expect(actionableMinScore(80)).toBe(80);
    expect(actionableMinScore(90)).toBe(90);
  });

  it("keeps a posting only when it clears the minimum and has a link", () => {
    expect(isActionable({ score: 80, url: "https://jobs.example/1" }, 80)).toBe(true);
    expect(isActionable({ score: 79, url: "https://jobs.example/1" }, 80)).toBe(false);
    expect(isActionable({ score: 95, url: "" }, 80)).toBe(false);
    expect(isActionable({ score: 95, url: "   " }, 80)).toBe(false);
  });
});

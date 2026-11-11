import { describe, expect, it } from "vitest";

import { nextFitScale, scalePercent, SCALE_PERCENTS } from "./resume-fit";
import { MIN_RESUME_SCALE } from "./settings";

describe("nextFitScale (Pathfinder)", () => {
  it("steps the scale down while the resume is more than one page", () => {
    expect(nextFitScale(2, 1)).toBeCloseTo(0.98, 5);
    expect(nextFitScale(3, 0.9)).toBeCloseTo(0.88, 5);
  });

  it("stops once it fits one page — that scale is the largest that fits", () => {
    expect(nextFitScale(1, 0.84)).toBeNull();
  });

  it("stops at the smallest allowed scale, even if it still overflows", () => {
    expect(nextFitScale(2, MIN_RESUME_SCALE)).toBeNull();
    // The last step never goes below the minimum.
    expect(nextFitScale(2, MIN_RESUME_SCALE + 0.01)).toBe(MIN_RESUME_SCALE);
  });
});

describe("the manual scale choices", () => {
  it("runs from full size down to the minimum in whole percentages", () => {
    expect(SCALE_PERCENTS[0]).toBe(100);
    expect(SCALE_PERCENTS.at(-1)).toBe(Math.round(MIN_RESUME_SCALE * 100));
    expect(SCALE_PERCENTS.every((percent) => Number.isInteger(percent))).toBe(true);
  });

  it("labels a scale as a percentage", () => {
    expect(scalePercent(1)).toBe("100%");
    expect(scalePercent(0.8)).toBe("80%");
  });
});

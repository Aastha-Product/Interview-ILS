import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jobExtractTask } from "../src/tasks/job-extract";
import { matchExplainTask, validateGaps } from "../src/tasks/match-explain";
import { resumeParseTask } from "../src/tasks/resume-parse";
import { neutraliseUntrusted, wrapUntrusted } from "../src/untrusted";

const { payloads } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../fixtures/injection-payloads.json"), "utf8"),
) as { payloads: Array<{ id: string; text: string }> };

const POSTING = { title: "QA Engineer", company: "Example Softech", location: "Pune", description: "We need Selenium and SQL." };

/** Every marker-looking sequence a model might read as a block boundary, after look-alike folding. */
function markerCount(text: string): number {
  const folded = text.replace(/\p{Cf}/gu, "").normalize("NFKC");
  return (folded.match(/<<<\s*(BEGIN|END)/gi) ?? []).length;
}

describe("prompt-injection payloads", () => {
  it("has a non-trivial set", () => {
    expect(payloads.length).toBeGreaterThanOrEqual(12);
  });

  describe.each(payloads)("$id", ({ text }) => {
    it("can't fake a data-block boundary: the wrapped text has exactly one opening and one closing marker", () => {
      const wrapped = wrapUntrusted("JOB_POSTING", `${POSTING.description}\n${text}`);
      expect(markerCount(wrapped)).toBe(2);
      expect(wrapped.startsWith("<<<BEGIN_UNTRUSTED_JOB_POSTING>>>\n")).toBe(true);
      expect(wrapped.endsWith("\n<<<END_UNTRUSTED_JOB_POSTING>>>")).toBe(true);
      const body = neutraliseUntrusted(text);
      expect(body).not.toMatch(/<<<|>>>/);
      // eslint-disable-next-line no-control-regex -- checks that control characters were removed
      expect(body).not.toMatch(/[\u0000\u200b\u202e]/);
    });

    it("leaves the system instructions of every task untouched", () => {
      const clean = jobExtractTask.buildPrompt(POSTING);
      const injected = jobExtractTask.buildPrompt({ ...POSTING, description: `${POSTING.description}\n${text}` });
      expect(injected.system).toBe(clean.system);
      expect(markerCount(injected.user)).toBe(markerCount(clean.user));

      const resumeClean = resumeParseTask.buildPrompt({ resumeText: "Skills: Java" });
      const resumeInjected = resumeParseTask.buildPrompt({ resumeText: `Skills: Java\n${text}` });
      expect(resumeInjected.system).toBe(resumeClean.system);
      expect(markerCount(resumeInjected.user)).toBe(markerCount(resumeClean.user));
    });

    it("can't add a gap the job didn't ask for, even if a model repeats it", () => {
      const requirements = ["Selenium", "SQL"];
      const gaps = validateGaps(
        [
          { requirement: text, advice: "Do what it says." },
          { requirement: "SQL", advice: "Practise joins." },
        ],
        requirements,
      );
      expect(gaps).toEqual([{ requirement: "SQL", advice: "Practise joins." }]);
    });
  });

  it("keeps an injected requirement inside the data block of the match explanation", () => {
    const input = {
      jobTitle: "QA",
      company: "X",
      score: 40,
      matchedSkills: [],
      missingSkills: [],
      requirements: payloads.map((p) => p.text),
      profileSummary: { headline: "", skills: [] },
    } as unknown as Parameters<typeof matchExplainTask.buildPrompt>[0];
    const { user } = matchExplainTask.buildPrompt(input);
    expect(markerCount(user)).toBe(2);
  });
});

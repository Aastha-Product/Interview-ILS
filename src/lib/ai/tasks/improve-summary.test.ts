import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import type { ChatCall } from "../provider";
import { MockProvider } from "../providers/mock";

import { improveSummary, IMPROVE_SUMMARY_VERSION } from "./improve-summary";

const OPTIONS = { creativity: "BALANCED", strict: true, language: null } as const;

describe("improveSummary (assistant: update my resume)", () => {
  it("returns the model's summary, trimmed, with its prompt version", async () => {
    const provider = new MockProvider({ reply: () => ({ summary: "  Product leader who ships AI tools, browser extensions and mobile apps.  " }) });
    const { data, promptVersion } = await improveSummary(provider, { profile: demoProfile() }, OPTIONS);
    expect(data).toBe("Product leader who ships AI tools, browser extensions and mobile apps.");
    expect(promptVersion).toBe(IMPROVE_SUMMARY_VERSION);
  });

  it("sends the profile and the student's instruction to the model", async () => {
    let seen = "";
    const provider = new MockProvider({
      reply: (call: ChatCall) => {
        seen = call.messages.at(-1)?.content ?? "";
        return { summary: "A crisp summary." };
      },
    });
    await improveSummary(provider, { profile: demoProfile(), instruction: "make it shorter and lead with my PM work" }, OPTIONS);
    expect(seen).toContain("make it shorter and lead with my PM work");
    // The profile is given to the model to write from.
    expect(seen.length).toBeGreaterThan(50);
  });
});

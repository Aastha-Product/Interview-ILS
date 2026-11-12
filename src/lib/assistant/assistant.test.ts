import { describe, expect, it } from "vitest";

import { assistantReplySchema, assistantSystem, availableDestinations, destinationLabel, DESTINATIONS } from "./assistant";

const TOOLS = [
  { name: "update_profile", description: "Update the profile basics." },
  { name: "set_job_search", description: "Set the job agent search." },
];
const APPS = [{ id: "app-1", company: "Acme", role: "Frontend Engineer", status: "DRAFTING" }];

describe("assistant destinations (Pathfinder)", () => {
  it("offers the job tools only where they're on", () => {
    const off = availableDestinations(false).map((destination) => destination.path);
    expect(off).toContain("/resume");
    expect(off).not.toContain("/jobs");
    expect(availableDestinations(true).map((destination) => destination.path)).toContain("/jobs");
  });

  it("names a screen by its label, and falls back to the path", () => {
    expect(destinationLabel("/applications")).toBe("Applications");
    expect(destinationLabel("/nowhere")).toBe("/nowhere");
  });
});

describe("the reply shape the model must return", () => {
  // Kept Gemini-safe: plain nullable strings and a string-encoded args object (no z.record/enum/.catch).
  const schema = assistantReplySchema();

  it("takes an answer, a screen to link to, and an action whose args are a JSON string", () => {
    const reply = schema.parse({ text: "I'll set your title.", navigate: "/resume", proposal: { tool: "update_profile", args: '{"headline":"PM"}' } });
    expect(reply).toEqual({ text: "I'll set your title.", navigate: "/resume", proposal: { tool: "update_profile", args: '{"headline":"PM"}' } });
  });

  it("allows null for the screen and the action", () => {
    expect(schema.parse({ text: "Here's how.", navigate: null, proposal: null })).toEqual({ text: "Here's how.", navigate: null, proposal: null });
  });

  it("needs some answer text", () => {
    expect(schema.safeParse({ text: "", navigate: null, proposal: null }).success).toBe(false);
  });
});

describe("the system prompt", () => {
  it("lists the actions, screens and the student's applications, and says actions need confirming", () => {
    const system = assistantSystem(availableDestinations(true), TOOLS, APPS, "/resume");
    expect(system).toContain("- update_profile: Update the profile basics.");
    expect(system).toContain("/applications (Applications)");
    expect(system).toContain("- app-1: Frontend Engineer at Acme (drafting)");
    expect(system).toMatch(/confirm/i);
    expect(system).toContain("on /resume (Base resume) right now");
  });

  it("says there are no actions or applications when there are none, and locates an unknown screen loosely", () => {
    const system = assistantSystem([...DESTINATIONS], [], [], "/print/base");
    expect(system).toContain("(no actions available)");
    expect(system).toContain("(no applications yet)");
    expect(system).toContain("somewhere in Pathfinder");
  });
});

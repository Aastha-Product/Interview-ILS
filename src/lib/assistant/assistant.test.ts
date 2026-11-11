import { describe, expect, it } from "vitest";

import { assistantReplySchema, assistantSystem, availableDestinations, destinationLabel, DESTINATIONS } from "./assistant";

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
  const schema = assistantReplySchema(["/", "/resume"]);

  it("takes an answer and an allowed screen", () => {
    expect(schema.parse({ text: "Here you go.", navigate: "/resume" })).toEqual({ text: "Here you go.", navigate: "/resume" });
  });

  it("drops a screen that isn't on offer, rather than failing", () => {
    expect(schema.parse({ text: "Answer.", navigate: "/evil" }).navigate).toBeNull();
    expect(schema.parse({ text: "Answer." }).navigate).toBeNull();
  });

  it("needs some answer text", () => {
    expect(schema.safeParse({ text: "", navigate: null }).success).toBe(false);
  });
});

describe("the system prompt", () => {
  it("lists the screens and says it can't change anything, with where the student is", () => {
    const system = assistantSystem(availableDestinations(true), "/resume");
    expect(system).toContain("/applications (Applications)");
    expect(system).toMatch(/can't (change|edit)|cannot change/i);
    expect(system).toContain("on /resume (Base resume) right now");
  });

  it("says the student is somewhere in Pathfinder when the screen isn't one it knows", () => {
    expect(assistantSystem([...DESTINATIONS], "/print/base")).toContain("somewhere in Pathfinder");
  });
});

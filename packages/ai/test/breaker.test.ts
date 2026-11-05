import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAiClient } from "../src/client";
import type { AiProvider, AiRunRecord, TaskDefinition } from "../src/types";

const task: TaskDefinition<{ q: string }, { answer: string }> = {
  name: "test.echo",
  promptVersion: "v1",
  outputSchema: z.object({ answer: z.string() }),
  buildPrompt: ({ q }) => ({ system: "sys", user: q }),
  mock: ({ q }) => ({ answer: q }),
};

/** A provider whose behaviour can be switched between calls. */
function switchable(name: string, initial: "ok" | "down" | "garbage" = "ok") {
  const p = {
    name,
    mode: initial as "ok" | "down" | "garbage",
    calls: 0,
    async generate() {
      p.calls++;
      if (p.mode === "down") throw Object.assign(new Error("unavailable"), { status: 503 });
      const text = p.mode === "garbage" ? "not json" : JSON.stringify({ answer: name });
      return { text, model: `${name}-model`, inputTokens: 1, outputTokens: 1 };
    },
  };
  return p satisfies AiProvider;
}

function setup(options: { fallback?: boolean } = {}) {
  let clock = 1_000_000;
  const primary = switchable("primary");
  const fallback = options.fallback === false ? undefined : switchable("fallback");
  const client = createAiClient({ provider: primary, fallback, maxAttempts: 1, sleep: async () => {}, now: () => clock });
  return { primary, fallback, client, advance: (ms: number) => void (clock += ms) };
}

describe("circuit breaker", () => {
  it("opens after 5 outage failures in a minute, uses the fallback for 2 minutes, then tries the primary again", async () => {
    const { primary, fallback, client, advance } = setup();
    primary.mode = "down";
    // maxAttempts 1: each failing call gets one primary try, then one fallback try (last resort).
    for (let i = 0; i < 5; i++) {
      await expect(client.run(task, { q: "x" })).resolves.toEqual({ answer: "fallback" });
      advance(1_000);
    }
    expect(primary.calls).toBe(5);

    // Open: the primary isn't called at all.
    primary.mode = "ok";
    await expect(client.run(task, { q: "x" })).resolves.toEqual({ answer: "fallback" });
    expect(primary.calls).toBe(5);
    advance(119_000 - 5_000);
    await client.run(task, { q: "x" });
    expect(primary.calls).toBe(5);

    // After 2 minutes the primary is back in use.
    advance(10_000);
    await expect(client.run(task, { q: "x" })).resolves.toEqual({ answer: "primary" });
    expect(primary.calls).toBe(6);
    expect(fallback!.calls).toBe(7);
  });

  it("doesn't open for failures spread over more than a minute", async () => {
    const { primary, client, advance } = setup();
    primary.mode = "down";
    for (let i = 0; i < 6; i++) {
      await client.run(task, { q: "x" });
      advance(20_000);
    }
    primary.mode = "ok";
    await expect(client.run(task, { q: "x" })).resolves.toEqual({ answer: "primary" });
  });

  it("doesn't count bad answers as an outage", async () => {
    const { primary, fallback, client } = setup();
    primary.mode = "garbage";
    for (let i = 0; i < 6; i++) await expect(client.run(task, { q: "x" })).rejects.toMatchObject({ kind: "invalid_output" });
    expect(fallback!.calls).toBe(0);
    primary.mode = "ok";
    await expect(client.run(task, { q: "x" })).resolves.toEqual({ answer: "primary" });
  });

  it("fails fast while open when there is no fallback", async () => {
    const { primary, client } = setup({ fallback: false });
    primary.mode = "down";
    for (let i = 0; i < 5; i++) await expect(client.run(task, { q: "x" })).rejects.toMatchObject({ kind: "server_error" });
    primary.mode = "ok";
    await expect(client.run(task, { q: "x" })).rejects.toMatchObject({ kind: "circuit_open" });
    expect(primary.calls).toBe(5);
  });
});

describe("fallback as a last resort", () => {
  it("gets one try after the primary uses up its retries, and every attempt is recorded with its model", async () => {
    const primary = switchable("primary", "down");
    const fallback = switchable("fallback");
    const runs: AiRunRecord[] = [];
    const client = createAiClient({ provider: primary, fallback, sleep: async () => {} });
    await expect(client.run(task, { q: "x" }, { recorder: { record: async (r) => void runs.push(r) } })).resolves.toEqual({
      answer: "fallback",
    });
    expect(primary.calls).toBe(3);
    expect(runs.map((r) => [r.model, r.outcome])).toEqual([
      ["primary", "server_error"],
      ["primary", "server_error"],
      ["primary", "server_error"],
      ["fallback-model", "ok"],
    ]);
  });

  it("isn't used for a rejected request (a 4xx won't get better elsewhere)", async () => {
    const primary = { name: "primary", calls: 0, async generate() {
      primary.calls++;
      throw Object.assign(new Error("bad"), { status: 400 });
    } };
    const fallback = switchable("fallback");
    const client = createAiClient({ provider: primary, fallback, sleep: async () => {} });
    await expect(client.run(task, { q: "x" })).rejects.toMatchObject({ kind: "bad_request" });
    expect(fallback.calls).toBe(0);
  });

  it("isn't tried once the deadline has passed", async () => {
    const primary = switchable("primary", "down");
    const fallback = switchable("fallback");
    let clock = 0;
    const client = createAiClient({ provider: primary, fallback, now: () => clock, sleep: async (ms) => void (clock += ms) });
    // The primary's single attempt "takes" the whole budget.
    primary.generate = async () => {
      primary.calls++;
      clock += 600;
      throw Object.assign(new Error("down"), { status: 503 });
    };
    await expect(client.run(task, { q: "x" }, { deadline: 500 })).rejects.toMatchObject({ kind: "timeout" });
    expect(fallback.calls).toBe(0);
  });
});

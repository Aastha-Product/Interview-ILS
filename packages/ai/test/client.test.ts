import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAiClient } from "../src/client";
import { AiError } from "../src/errors";
import type { AiProvider, AiRunRecord, TaskDefinition } from "../src/types";

const task: TaskDefinition<{ q: string }, { answer: string }> = {
  name: "test.echo",
  promptVersion: "v1",
  outputSchema: z.object({ answer: z.string() }),
  buildPrompt: ({ q }) => ({ system: "sys", user: q }),
  mock: ({ q }) => ({ answer: q }),
};

function scriptedProvider(steps: Array<() => Promise<string>>): AiProvider & { calls: number } {
  const provider = {
    name: "scripted",
    calls: 0,
    async generate() {
      const step = steps[provider.calls++];
      if (!step) throw new Error("no more steps");
      const text = await step();
      return { text, model: "test-model", inputTokens: 10, outputTokens: 5 };
    },
  };
  return provider;
}

function recorder() {
  const runs: AiRunRecord[] = [];
  return { runs, record: async (r: AiRunRecord) => void runs.push(r) };
}

describe("AI client", () => {
  it("returns validated output and records one run with a hash, not the prompt", async () => {
    const rec = recorder();
    const client = createAiClient({ provider: scriptedProvider([async () => '{"answer":"hi"}']) });
    await expect(client.run(task, { q: "secret resume text" }, { recorder: rec })).resolves.toEqual({ answer: "hi" });
    expect(rec.runs).toHaveLength(1);
    expect(rec.runs[0]).toMatchObject({ task: "test.echo@v1", model: "test-model", outcome: "ok", inputTokens: 10 });
    expect(rec.runs[0]!.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rec.runs)).not.toContain("secret resume text");
  });

  it("retries server errors with 1 s then 2 s backoff plus jitter", async () => {
    const sleep = vi.fn(async () => {});
    const provider = scriptedProvider([
      async () => Promise.reject(Object.assign(new Error("boom"), { status: 503 })),
      async () => Promise.reject(Object.assign(new Error("slow down"), { status: 429 })),
      async () => '{"answer":"third time"}',
    ]);
    const rec = recorder();
    const client = createAiClient({ provider, sleep, random: () => 0.5 });
    await expect(client.run(task, { q: "x" }, { recorder: rec })).resolves.toEqual({ answer: "third time" });
    expect(provider.calls).toBe(3);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1125, 2250]);
    expect(rec.runs.map((r) => r.outcome)).toEqual(["server_error", "rate_limited", "ok"]);
  });

  it("gives up after 3 attempts", async () => {
    const fail = async () => Promise.reject(Object.assign(new Error("down"), { status: 500 }));
    const provider = scriptedProvider([fail, fail, fail, fail]);
    const client = createAiClient({ provider, sleep: async () => {} });
    await expect(client.run(task, { q: "x" })).rejects.toMatchObject({ kind: "server_error" });
    expect(provider.calls).toBe(3);
  });

  it("does not retry a rejected request", async () => {
    const provider = scriptedProvider([
      async () => Promise.reject(Object.assign(new Error("bad key"), { status: 403 })),
      async () => '{"answer":"never"}',
    ]);
    const client = createAiClient({ provider, sleep: async () => {} });
    await expect(client.run(task, { q: "x" })).rejects.toMatchObject({ kind: "bad_request" });
    expect(provider.calls).toBe(1);
  });

  it("retries when the answer has the wrong shape, then succeeds", async () => {
    const provider = scriptedProvider([
      async () => "not json",
      async () => '{"wrong":"shape"}',
      async () => '{"answer":"ok"}',
    ]);
    const rec = recorder();
    const client = createAiClient({ provider, sleep: async () => {} });
    await expect(client.run(task, { q: "x" }, { recorder: rec })).resolves.toEqual({ answer: "ok" });
    expect(rec.runs.map((r) => r.outcome)).toEqual(["invalid_output", "invalid_output", "ok"]);
  });

  it("times out a hung call", async () => {
    const provider = scriptedProvider([() => new Promise<string>(() => {})]);
    const client = createAiClient({ provider, maxAttempts: 1, timeoutMs: 20 });
    const error = await client.run(task, { q: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("timeout");
  });
});

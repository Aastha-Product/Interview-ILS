import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError } from "./errors";
import type { AIProvider, CompletionRequest } from "./provider";
import { costMicroUsd, logsOnly, modelRoutes, routedProvider, routesApply, singleModel, type CallRecord } from "./routing";

vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

// Pathfinder: on the server's Claude key, each task gets its model, a busy model hands over to a
// backup once, and every call is logged with its tokens and cost.

/** A provider for one model that answers, or fails with `failWith`, and reports 1000/200 tokens. */
function fake(model: string, failWith?: AiError): AIProvider {
  return {
    kind: "MOCK",
    model,
    complete: vi.fn(async (request: CompletionRequest) => {
      request.onUsage?.({ model, input: 1000, output: 200 });
      if (failWith) throw failWith;
      return "schema" in request ? { answeredBy: model } : `text from ${model}`;
    }) as AIProvider["complete"],
    listModels: async () => [model],
    test: async () => ({ model, latencyMs: 1 }),
  };
}

const routes = { main: "claude-opus-5-5", reading: "claude-sonnet-5-5", fallback: "claude-haiku-5-5" };
const json = (schemaName: string) => ({ system: "s", messages: [], schema: z.object({ answeredBy: z.string() }), schemaName });

function setup(failing: Record<string, AiError> = {}) {
  const providers = new Map<string, AIProvider>();
  const forModel = (model: string) => providers.get(model) ?? providers.set(model, fake(model, failing[model])).get(model)!;
  const records: CallRecord[] = [];
  const provider = routedProvider(forModel, routes, async (call) => {
    records.push(call);
  });
  return { provider, records };
}

describe("routedProvider", () => {
  it("reads a resume with the reading model and reviews it with the main one", async () => {
    const { provider, records } = setup();
    await expect(provider.complete(json("extracted_profile"))).resolves.toEqual({ answeredBy: "claude-sonnet-5-5" });
    await expect(provider.complete(json("resume_review"))).resolves.toEqual({ answeredBy: "claude-opus-5-5" });
    expect(records.map(({ task, model, outcome }) => [task, model, outcome])).toEqual([
      ["extracted_profile", "claude-sonnet-5-5", "ok"],
      ["resume_review", "claude-opus-5-5", "ok"],
    ]);
    expect(records[0].usage).toEqual([{ model: "claude-sonnet-5-5", input: 1000, output: 200 }]);
  });

  it("hands a busy model's request to the fallback once, and logs both calls", async () => {
    const { provider, records } = setup({ "claude-opus-5-5": AiError.of("busy") });
    await expect(provider.complete(json("resume_review"))).resolves.toEqual({ answeredBy: "claude-haiku-5-5" });
    expect(records.map(({ model, outcome }) => [model, outcome])).toEqual([
      ["claude-opus-5-5", "busy"],
      ["claude-haiku-5-5", "ok"],
    ]);
  });

  it("doesn't hand over what another model can't fix, such as a bad key or a cut-off answer", async () => {
    for (const failure of [AiError.config("bad key"), AiError.of("cut-off"), AiError.of("daily-limit")]) {
      const { provider, records } = setup({ "claude-opus-5-5": failure });
      await expect(provider.complete(json("resume_review"))).rejects.toBe(failure);
      expect(records.map(({ model }) => model)).toEqual(["claude-opus-5-5"]);
    }
  });

  it("gives up when the fallback fails too", async () => {
    const { provider, records } = setup({ "claude-opus-5-5": AiError.of("busy"), "claude-haiku-5-5": AiError.of("rate-limited") });
    await expect(provider.complete(json("resume_review"))).rejects.toMatchObject({ kind: "rate-limited" });
    expect(records).toHaveLength(2);
  });

  it("logs plain text answers under 'text'", async () => {
    const { provider, records } = setup();
    await expect(provider.complete({ system: "s", messages: [] })).resolves.toBe("text from claude-opus-5-5");
    expect(records[0]).toMatchObject({ task: "text", model: "claude-opus-5-5" });
  });
});

describe("the cost log on other providers (admin console)", () => {
  const config = (provider: string, sharedKey: boolean, model: string | null = "a-model") => ({ provider, sharedKey, model }) as never;

  it("logs every call on the server's own key, routing only on Claude", () => {
    expect(routesApply(config("ANTHROPIC", true))).toBe(true);
    expect(logsOnly(config("ANTHROPIC", true))).toBe(false);
    expect(logsOnly(config("OPENAI", true, "gemini-3.5-flash"))).toBe(true);
    // A student's own key, or no model: not the server's money, nothing to log.
    expect(logsOnly(config("OPENAI", false))).toBe(false);
    expect(logsOnly(config("OPENAI", true, null))).toBe(false);
  });

  it("keeps every task on the one model and never hands over", async () => {
    const records: CallRecord[] = [];
    const busy = AiError.of("busy");
    const forModel = (model: string) => fake(model, model === "gemini-3.5-flash" ? undefined : busy);
    const provider = routedProvider(forModel, singleModel("gemini-3.5-flash", {}), async (call) => {
      records.push(call);
    });
    await expect(provider.complete(json("extracted_profile"))).resolves.toEqual({ answeredBy: "gemini-3.5-flash" });
    expect(records).toMatchObject([{ task: "extracted_profile", model: "gemini-3.5-flash", outcome: "ok" }]);
    // No known price: logged with its tokens, and no cost.
    expect(costMicroUsd({ model: "gemini-3.5-flash", input: 1000, output: 200 })).toBeNull();
  });
});

describe("a backup model on other providers", () => {
  it("has none unless PATHFINDER_AI_FALLBACK_MODEL names one, and never the same model or off", () => {
    expect(singleModel("gemini-3.5-flash", {}).fallback).toBeNull();
    expect(singleModel("gemini-3.5-flash", { PATHFINDER_AI_FALLBACK_MODEL: "off" }).fallback).toBeNull();
    expect(singleModel("gemini-3.5-flash", { PATHFINDER_AI_FALLBACK_MODEL: "gemini-3.5-flash" }).fallback).toBeNull();
    expect(singleModel("gemini-3.5-flash", { PATHFINDER_AI_FALLBACK_MODEL: "gemini-3.5-flash-lite" })).toEqual({
      main: "gemini-3.5-flash",
      reading: "gemini-3.5-flash",
      fallback: "gemini-3.5-flash-lite",
    });
  });

  it("hands a busy Gemini request to the backup once, and logs both calls", async () => {
    const records: CallRecord[] = [];
    const forModel = (model: string) => fake(model, model === "gemini-3.5-flash" ? AiError.of("busy") : undefined);
    const provider = routedProvider(forModel, singleModel("gemini-3.5-flash", { PATHFINDER_AI_FALLBACK_MODEL: "gemini-3.5-flash-lite" }), async (call) => {
      records.push(call);
    });
    await expect(provider.complete(json("resume_review"))).resolves.toEqual({ answeredBy: "gemini-3.5-flash-lite" });
    expect(records.map(({ model, outcome }) => [model, outcome])).toEqual([
      ["gemini-3.5-flash", "busy"],
      ["gemini-3.5-flash-lite", "ok"],
    ]);
  });
});

describe("modelRoutes", () => {
  it("defaults reading and the fallback to Sonnet, and turns the fallback off on request", () => {
    expect(modelRoutes("claude-opus-5-5", {})).toEqual({ main: "claude-opus-5-5", reading: "claude-sonnet-5-5", fallback: "claude-sonnet-5-5" });
    expect(modelRoutes("claude-opus-5-5", { PATHFINDER_AI_READING_MODEL: "claude-haiku-5-5", PATHFINDER_AI_FALLBACK_MODEL: "off" })).toEqual({
      main: "claude-opus-5-5",
      reading: "claude-haiku-5-5",
      fallback: null,
    });
  });
});

describe("costMicroUsd", () => {
  it("prices tokens at the model's list price, in millionths of a dollar", () => {
    // 5,000 in at $4/M and 2,000 out at $20/M: $0.02 + $0.04.
    expect(costMicroUsd({ model: "claude-opus-5-5", input: 5000, output: 2000 })).toBe(60_000);
    expect(costMicroUsd({ model: "claude-sonnet-5-5", input: 5000, output: 2000 })).toBe(30_000);
    expect(costMicroUsd({ model: "someone-elses-model", input: 5000, output: 2000 })).toBeNull();
  });
});

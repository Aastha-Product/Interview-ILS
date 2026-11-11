import { describe, expect, it, vi } from "vitest";

import { assertPublicAiAddress, PRIVATE_AI_ADDRESS, withAddressGuard } from "./address-guard";
import type { AIProvider } from "./provider";

// Pathfinder (QA M-2): a student's AI address can't point the server at its own network.

const dns = (answers: Record<string, string[]>) => async (hostname: string) => {
  const found = answers[hostname];
  if (!found) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
  return found.map((address) => ({ address }));
};

describe("assertPublicAiAddress", () => {
  it("lets a provider's public address through", async () => {
    const resolve = dns({ "api.openai.com": ["162.159.140.245"], "openrouter.ai": ["2606:4700::6812:1a0b"] });
    await expect(assertPublicAiAddress("https://api.openai.com/v1", resolve)).resolves.toBeUndefined();
    await expect(assertPublicAiAddress("https://openrouter.ai/api/v1", resolve)).resolves.toBeUndefined();
    await expect(assertPublicAiAddress("https://8.8.8.8/v1", resolve)).resolves.toBeUndefined();
  });

  it("refuses the server's own network by IP: loopback, private, link-local (cloud metadata), mapped IPv6", async () => {
    for (const url of [
      "http://127.0.0.1:11434",
      "http://10.0.0.5/v1",
      "http://172.18.0.2:5432",
      "http://192.168.1.10:1234",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]:11434",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/",
      "http://0.0.0.0:3000",
    ]) {
      await expect(assertPublicAiAddress(url, dns({})), url).rejects.toThrow(PRIVATE_AI_ADDRESS);
    }
  });

  it("refuses names for it: localhost, a container's name, or one that resolves to a private address", async () => {
    const resolve = dns({ "host.docker.internal": ["192.168.65.254"], "rebind.example.com": ["93.184.216.34", "10.0.0.1"] });
    for (const url of ["http://localhost:11434", "http://app.localhost/", "http://db:5432", "http://ollama:11434", "http://host.docker.internal:1234", "https://rebind.example.com/v1"]) {
      await expect(assertPublicAiAddress(url, resolve), url).rejects.toThrow(PRIVATE_AI_ADDRESS);
    }
  });

  it("leaves a name that doesn't resolve for the request to report, and refuses what isn't an address", async () => {
    await expect(assertPublicAiAddress("https://no-such-host.example/v1", dns({}))).resolves.toBeUndefined();
    await expect(assertPublicAiAddress("not a url", dns({}))).rejects.toThrow(PRIVATE_AI_ADDRESS);
  });
});

describe("withAddressGuard", () => {
  const inner = (): AIProvider => ({
    kind: "OPENAI",
    model: "gpt-x",
    complete: vi.fn(async () => "answer") as unknown as AIProvider["complete"],
    listModels: vi.fn(async () => ["gpt-x"]),
    test: vi.fn(async () => ({ model: "gpt-x", latencyMs: 5 })),
  });

  it("checks before every kind of request, and sends nothing to a private address", async () => {
    const provider = inner();
    const guarded = withAddressGuard(provider, "http://169.254.169.254/v1", dns({}));
    await expect(guarded.complete({ messages: [] } as never)).rejects.toThrow(PRIVATE_AI_ADDRESS);
    await expect(guarded.listModels()).rejects.toThrow(PRIVATE_AI_ADDRESS);
    await expect(guarded.test()).rejects.toThrow(PRIVATE_AI_ADDRESS);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(provider.listModels).not.toHaveBeenCalled();
    expect(provider.test).not.toHaveBeenCalled();
  });

  it("passes requests to a public address on", async () => {
    const provider = inner();
    const guarded = withAddressGuard(provider, "https://api.openai.com/v1", dns({ "api.openai.com": ["162.159.140.245"] }));
    expect(guarded).toMatchObject({ kind: "OPENAI", model: "gpt-x" });
    expect(await guarded.complete({ messages: [] } as never)).toBe("answer");
    expect(await guarded.listModels()).toEqual(["gpt-x"]);
    expect(await guarded.test()).toEqual({ model: "gpt-x", latencyMs: 5 });
  });
});

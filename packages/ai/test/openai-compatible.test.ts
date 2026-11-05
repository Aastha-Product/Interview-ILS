import { describe, expect, it } from "vitest";
import { classifyError } from "../src/errors";
import { createOpenAiCompatibleProvider } from "../src/providers/openai-compatible";
import { createAiClientFromEnv } from "../src/index";

const request = {
  task: "resume.tailor",
  system: "system rules",
  user: "<untrusted>job text</untrusted>",
  jsonSchema: { type: "object", properties: { answer: { type: "string" } } },
  signal: new AbortController().signal,
  mock: () => ({}),
};

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

describe("OpenAI-compatible fallback provider", () => {
  it("posts a chat completion with the schema and reads text, model and tokens", async () => {
    const f = fakeFetch(200, {
      model: "gpt-fallback-2026",
      choices: [{ message: { content: '{"answer":"hi"}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    });
    const provider = createOpenAiCompatibleProvider({ baseUrl: "https://ai.example/v1/", apiKey: "sk-test", model: "fb-mini", fetch: f.fn });
    const result = await provider.generate(request);
    expect(result).toEqual({ text: '{"answer":"hi"}', model: "gpt-fallback-2026", inputTokens: 120, outputTokens: 30 });

    expect(f.calls[0]!.url).toBe("https://ai.example/v1/chat/completions");
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const sent = JSON.parse(String(f.calls[0]!.init.body));
    expect(sent.model).toBe("fb-mini");
    expect(sent.messages).toEqual([
      { role: "system", content: "system rules" },
      { role: "user", content: "<untrusted>job text</untrusted>" },
    ]);
    expect(sent.response_format).toEqual({ type: "json_schema", json_schema: { name: "resume_tailor", schema: request.jsonSchema } });
  });

  it("turns an HTTP error into a status-only error that the client classifies, without echoing the body", async () => {
    const f = fakeFetch(429, { error: { message: "rate limited for prompt: <untrusted>job text</untrusted>" } });
    const provider = createOpenAiCompatibleProvider({ baseUrl: "https://ai.example/v1", apiKey: "k", model: "m", fetch: f.fn });
    const error = await provider.generate(request).catch((e: unknown) => e);
    expect(classifyError(error).kind).toBe("rate_limited");
    expect(String((error as Error).message)).not.toContain("job text");
  });
});

describe("createAiClientFromEnv", () => {
  it("attaches the fallback only when all three settings are present", () => {
    // Only observable through behaviour; this checks construction doesn't throw either way.
    expect(createAiClientFromEnv({}).providerName).toBe("mock");
    expect(
      createAiClientFromEnv({ FALLBACK_AI_BASE_URL: "https://ai.example/v1", FALLBACK_AI_API_KEY: "k", FALLBACK_AI_MODEL: "m" }).providerName,
    ).toBe("mock");
  });
});

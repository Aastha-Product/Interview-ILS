import type { AiProvider, ProviderRequest, ProviderResponse } from "../types";

export interface OpenAiCompatibleOptions {
  /** API root that serves /chat/completions, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * The fallback model: any OpenAI-compatible Chat Completions API, called with plain fetch (no SDK).
 * Asks for JSON matching the task's schema; the AI client validates the answer with Zod either way.
 * Errors carry only the HTTP status, never the response body (it can echo the prompt).
 */
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): AiProvider {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    name: "openai-compatible",
    async generate(request: ProviderRequest): Promise<ProviderResponse> {
      const response = await doFetch(url, {
        method: "POST",
        signal: request.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({
          model: options.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: request.task.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64), schema: request.jsonSchema },
          },
        }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw Object.assign(new Error(`Fallback AI returned HTTP ${response.status}`), { status: response.status });
      }
      const body = (await response.json()) as ChatCompletion;
      return {
        text: body.choices?.[0]?.message?.content ?? "",
        model: body.model ?? options.model,
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      };
    },
  };
}

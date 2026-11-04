import type { AiProvider, ProviderRequest, ProviderResponse } from "../types";

/**
 * Keyless provider for development and tests. Returns each task's own deterministic mock answer.
 * Token counts are rough estimates (4 characters per token) so usage records still fill in.
 */
export function createMockProvider(): AiProvider {
  return {
    name: "mock",
    async generate(request: ProviderRequest): Promise<ProviderResponse> {
      const text = JSON.stringify(request.mock());
      return {
        text,
        model: "mock",
        inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
      };
    },
  };
}

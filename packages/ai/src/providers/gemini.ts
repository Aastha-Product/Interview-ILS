import { GoogleGenAI } from "@google/genai";
import type { AiProvider, ProviderRequest, ProviderResponse } from "../types";

export interface GeminiOptions {
  apiKey: string;
  model: string;
}

/** Google Gemini through the official @google/genai SDK, with JSON output constrained by schema. */
export function createGeminiProvider({ apiKey, model }: GeminiOptions): AiProvider {
  const client = new GoogleGenAI({ apiKey });
  return {
    name: "gemini",
    async generate(request: ProviderRequest): Promise<ProviderResponse> {
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        config: {
          systemInstruction: request.system,
          responseMimeType: "application/json",
          responseJsonSchema: request.jsonSchema,
          temperature: 0.2,
          abortSignal: request.signal,
        },
      });
      return {
        text: response.text ?? "",
        model: response.modelVersion ?? model,
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      };
    },
  };
}

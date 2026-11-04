import "server-only";
import { createAiClientFromEnv, type AiClient } from "@pathfinder/ai";
import { getConfig, getStorage, type FileStorage } from "@pathfinder/core";

let ai: AiClient | undefined;

/** Gemini when GEMINI_API_KEY is set, otherwise the keyless mock. */
export function getAi(): AiClient {
  ai ??= createAiClientFromEnv(getConfig());
  return ai;
}

export function getFileStorage(): FileStorage {
  return getStorage(getConfig());
}

import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isPublicAddress } from "@/lib/posting-fetch";

import { AiError } from "./errors";
import type { AIProvider } from "./provider";

// Pathfinder (QA M-2): an AI server's address a student saved in Settings is checked before
// every request, so it can't point this server at its own network: the database, the other
// containers, or the cloud's metadata address (169.254.169.254). The server's own address
// (DOSSIER_AI_URL) isn't checked: the people who run the server chose it.

export const PRIVATE_AI_ADDRESS =
  "Pathfinder doesn't send AI requests to addresses on its own network. In Settings → AI provider, use the provider's public address (https://…).";

type Resolve = (hostname: string) => Promise<{ address: string }[]>;
const resolveAll: Resolve = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Refuses an address on a private, local or reserved network, by its IP or by what its name
 * resolves to (every answer must be public). A name that doesn't resolve is left for the
 * request itself to report, as before.
 */
export async function assertPublicAiAddress(baseUrl: string, resolve: Resolve = resolveAll): Promise<void> {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw AiError.config(PRIVATE_AI_ADDRESS);
  }
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw AiError.config(PRIVATE_AI_ADDRESS);
    return;
  }
  if (/(^|\.)localhost\.?$/i.test(host) || !host.includes(".")) throw AiError.config(PRIVATE_AI_ADDRESS);
  let answers: { address: string }[];
  try {
    answers = await resolve(host);
  } catch {
    return;
  }
  if (answers.some((answer) => !isPublicAddress(answer.address))) throw AiError.config(PRIVATE_AI_ADDRESS);
}

/** `provider`, checking `baseUrl` before each request it makes. */
export function withAddressGuard(provider: AIProvider, baseUrl: string, resolve: Resolve = resolveAll): AIProvider {
  const check = () => assertPublicAiAddress(baseUrl, resolve);
  return {
    kind: provider.kind,
    model: provider.model,
    complete: (async (request: Parameters<AIProvider["complete"]>[0]) => {
      await check();
      return provider.complete(request as never);
    }) as AIProvider["complete"],
    listModels: async (signal) => {
      await check();
      return provider.listModels(signal);
    },
    test: async (signal) => {
      await check();
      return provider.test(signal);
    },
  };
}

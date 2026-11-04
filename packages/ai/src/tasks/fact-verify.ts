import { z } from "zod";
import { FACT_VERIFY_V1 } from "../prompts/fact-verify.v1";
import type { TaskDefinition } from "../types";
import { wrapUntrusted } from "../untrusted";
import { supportRatio } from "./drafting-text";

export interface FactVerifyInput {
  items: Array<{ id: string; text: string; facts: Array<{ id: string; text: string }> }>;
}

export const factVerifySchema = z.object({
  results: z.array(z.object({ id: z.string(), supported: z.boolean(), reason: z.string() })),
});

export type FactVerifyOutput = z.infer<typeof factVerifySchema>;

/** Share of an item's content words that must appear in its cited facts for the mock to accept it. */
export const MOCK_SUPPORT_THRESHOLD = 0.6;

/** Word-overlap stand-in for the model check, used by the keyless mock. */
export function heuristicVerify(input: FactVerifyInput): FactVerifyOutput {
  return {
    results: input.items.map((item) => {
      const ratio = supportRatio(item.text, item.facts.map((f) => f.text));
      const supported = ratio >= MOCK_SUPPORT_THRESHOLD;
      return {
        id: item.id,
        supported,
        reason: supported ? "" : "Says things the cited profile facts don't mention.",
      };
    }),
  };
}

export const factVerifyTask: TaskDefinition<FactVerifyInput, FactVerifyOutput> = {
  name: "fact.verify",
  promptVersion: FACT_VERIFY_V1.version,
  outputSchema: factVerifySchema,
  timeoutMs: 45_000,
  buildPrompt({ items }) {
    return {
      system: FACT_VERIFY_V1.system,
      user: ["Items to check, each with the facts it cites:", wrapUntrusted("ITEMS_TO_CHECK", JSON.stringify(items, null, 1))].join("\n\n"),
    };
  },
  mock: heuristicVerify,
};

import { UNTRUSTED_DATA_RULES } from "../untrusted";

/**
 * Prompt for the second, cheap check: is each drafted sentence supported by the facts it cites?
 * Never edit a released version in place; add fact-verify.v2.ts instead.
 */
export const FACT_VERIFY_V1 = {
  version: "v1",
  system: [
    "You check drafted resume bullets and application answers against the facts they cite.",
    "For each item, set supported to true only if every claim in it (actions, tools, numbers, employers, outcomes, scope)",
    "is stated or directly implied by the cited facts. Rewording is fine; new claims are not.",
    "If anything is added or exaggerated, set supported to false and give a short reason naming the unsupported claim.",
    "Return one result per item, using the item's id.",
    UNTRUSTED_DATA_RULES,
  ].join("\n"),
} as const;

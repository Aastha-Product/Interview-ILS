import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Cross-Origin-Opener-Policy", () => {
  it("lets the Continue with Google popup report back to the sign-in page", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const coop = rules.flatMap((rule) => rule.headers).filter((header) => header.key === "Cross-Origin-Opener-Policy");

    // "same-origin" cuts the popup off from its opener, so Firebase's
    // signInWithPopup never gets the result and Google sign-in fails silently.
    expect(coop).toEqual([{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }]);
  });
});

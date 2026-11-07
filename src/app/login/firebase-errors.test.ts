import { describe, expect, it } from "vitest";

import { firebaseErrorMessage } from "./firebase-errors";

const failure = (code: string) => Object.assign(new Error(code), { code });

describe("firebaseErrorMessage (Pathfinder)", () => {
  it("says the same for a wrong password and an unknown email, so neither gives away who has an account", () => {
    const wrong = firebaseErrorMessage(failure("auth/wrong-password"));
    expect(firebaseErrorMessage(failure("auth/user-not-found"))).toBe(wrong);
    expect(firebaseErrorMessage(failure("auth/invalid-credential"))).toBe(wrong);
  });

  it("says nothing when the student closed Google's window themselves", () => {
    expect(firebaseErrorMessage(failure("auth/popup-closed-by-user"))).toBeNull();
    expect(firebaseErrorMessage(failure("auth/cancelled-popup-request"))).toBeNull();
  });

  it("explains the rest in plain words, and falls back to trying again", () => {
    expect(firebaseErrorMessage(failure("auth/email-already-in-use"))).toMatch(/Sign in instead/);
    expect(firebaseErrorMessage(failure("auth/popup-blocked"))).toMatch(/pop-ups/);
    expect(firebaseErrorMessage(failure("auth/too-many-requests"))).toMatch(/Too many attempts/);
    // The server's Firebase settings are wrong: not the student's doing.
    expect(firebaseErrorMessage(failure("auth/api-key-not-valid.-please-pass-a-valid-api-key."))).toBe("Sign-in isn't fully set up on this server yet.");
    expect(firebaseErrorMessage(new Error("boom"))).toBe("Something went wrong. Try again.");
    expect(firebaseErrorMessage("nope")).toBe("Something went wrong. Try again.");
  });
});

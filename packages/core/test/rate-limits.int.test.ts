import { getPrisma } from "@pathfinder/db/raw";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../../db/test/helpers";
import { UserFacingError } from "../src/errors";
import { checkSignInLimit, enforceApiLimit } from "../src/rate-limits";

const config = { RATE_LIMIT_API_PER_MINUTE: 60, RATE_LIMIT_SIGNIN_PER_MINUTE: 10 };
const now = new Date("2026-11-05T10:00:15Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("enforceApiLimit", () => {
  it("allows 60 requests a minute per student, then refuses with a friendly 429 and Retry-After", async () => {
    for (let i = 0; i < 60; i++) await enforceApiLimit("student-a", { config, now });
    const error = await enforceApiLimit("student-a", { config, now }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error).toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterSeconds: 45 });
    expect((error as UserFacingError).message).toMatch(/wait a few seconds/);
    // Another student is unaffected.
    await expect(enforceApiLimit("student-b", { config, now })).resolves.toBeUndefined();
  });
});

describe("checkSignInLimit", () => {
  it("allows 10 sign-in attempts a minute per IP hash", async () => {
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await checkSignInLimit("iphash-1", { config, now }));
    expect(results.slice(0, 10).every((r) => r === null)).toBe(true);
    expect(results[10]).toBe(45);
    expect(await checkSignInLimit("iphash-2", { config, now })).toBeNull();
  });
});

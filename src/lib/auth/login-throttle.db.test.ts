import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { clientIp } from "./client-ip";
import { GLOBAL_KEY, loginWaitMs, PER_IP_ONLY, recordLoginFailure, recordLoginSuccess } from "./login-throttle";

const db = createTestClient();
const system = rawClientOf(db); // LoginThrottle is a system table
const start = new Date("2026-09-28T09:00:00Z");
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

async function failTimes(ip: string, count: number, from = 0) {
  for (let i = 0; i < count; i++) await recordLoginFailure(system, ip, at(from + i));
}

describe("login throttle", () => {
  it("blocks an IP for 30 s after five quick failures, without affecting other IPs", async () => {
    await failTimes("203.0.113.7", 4);
    expect(await loginWaitMs(system, "203.0.113.7", at(4))).toBe(0);

    await recordLoginFailure(system, "203.0.113.7", at(4));
    expect(await loginWaitMs(system, "203.0.113.7", at(4))).toBe(30_000);
    expect(await loginWaitMs(system, "203.0.113.7", at(34))).toBe(0);
    expect(await loginWaitMs(system, "198.51.100.2", at(4))).toBe(0);
  });

  it("resets the IP's counter after a successful sign-in, but not the global one", async () => {
    await failTimes("203.0.113.7", 4);
    await recordLoginSuccess(system, "203.0.113.7");
    expect(await system.loginThrottle.findUnique({ where: { key: "203.0.113.7" } })).toBeNull();
    expect((await system.loginThrottle.findUniqueOrThrow({ where: { key: GLOBAL_KEY } })).failures).toBe(4);
  });

  it("blocks everyone after 30 failures from many IPs (faked X-Forwarded-For)", async () => {
    for (let i = 0; i < 30; i++) await recordLoginFailure(system, `10.0.0.${i}`, at(i));
    expect(await loginWaitMs(system, "10.0.0.99", at(29))).toBe(30_000);
  });

  it("keeps sign-ins that can't be guessed out of the all-IPs count, so junk can't lock out everyone (QA H-3)", async () => {
    for (let i = 0; i < 40; i++) await recordLoginFailure(system, `10.0.0.${i}`, at(i), PER_IP_ONLY);
    expect(await system.loginThrottle.findUnique({ where: { key: GLOBAL_KEY } })).toBeNull();
    // A real student from a new address gets straight in.
    expect(await loginWaitMs(system, "198.51.100.77", at(40), PER_IP_ONLY)).toBe(0);
    // Each address still has its own limit.
    for (let i = 0; i < 5; i++) await recordLoginFailure(system, "203.0.113.7", at(50 + i), PER_IP_ONLY);
    expect(await loginWaitMs(system, "203.0.113.7", at(54), PER_IP_ONLY)).toBe(30_000);
    // An all-IPs block from the access code doesn't stop them either.
    for (let i = 0; i < 30; i++) await recordLoginFailure(system, `10.0.1.${i}`, at(60 + i));
    expect(await loginWaitMs(system, "198.51.100.77", at(89))).toBe(30_000);
    expect(await loginWaitMs(system, "198.51.100.77", at(89), PER_IP_ONLY)).toBe(0);
  });

  it("counts concurrent failures exactly", async () => {
    await Promise.all(Array.from({ length: 5 }, () => recordLoginFailure(system, "203.0.113.7", at(0))));
    expect((await system.loginThrottle.findUniqueOrThrow({ where: { key: "203.0.113.7" } })).failures).toBe(5);
    expect(await loginWaitMs(system, "203.0.113.7", at(0))).toBe(30_000);
  });

  it("prunes rows untouched for a day", async () => {
    await recordLoginFailure(system, "203.0.113.7", at(0));
    await recordLoginFailure(system, "198.51.100.2", at(24 * 60 * 60 + 1));
    expect((await system.loginThrottle.findMany({ select: { key: true }, orderBy: { key: "asc" } })).map((row) => row.key)).toEqual([
      GLOBAL_KEY,
      "198.51.100.2",
    ]);
  });
});

describe("clientIp", () => {
  it("takes the last X-Forwarded-For entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

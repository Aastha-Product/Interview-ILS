import { describe, expect, it } from "vitest";
import { clientIpFrom } from "../server/request-ip";

const headers = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

describe("clientIpFrom", () => {
  it("takes the address added by the trusted proxy, not the one the client wrote", () => {
    // The client forged "1.1.1.1"; the host's proxy appended the real address.
    expect(clientIpFrom(headers("1.1.1.1, 203.0.113.7"), 1)).toBe("203.0.113.7");
    expect(clientIpFrom(headers("203.0.113.7"), 1)).toBe("203.0.113.7");
  });

  it("counts back one entry per trusted proxy (e.g. a CDN in front of the host)", () => {
    expect(clientIpFrom(headers("1.1.1.1, 203.0.113.7, 198.51.100.2"), 2)).toBe("203.0.113.7");
  });

  it("ignores the header with no trusted proxy, and copes with missing or short headers", () => {
    expect(clientIpFrom(headers("203.0.113.7"), 0)).toBeNull();
    expect(clientIpFrom(headers(), 1)).toBeNull();
    expect(clientIpFrom(headers(" , "), 1)).toBeNull();
    expect(clientIpFrom(headers("203.0.113.7"), 2)).toBeNull();
  });
});

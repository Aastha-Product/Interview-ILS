import { describe, expect, it } from "vitest";
import { ConfigError, isDevSignInEnabled, parseConfig } from "../src/config";

const base = {
  DATABASE_URL: "postgresql://pathfinder:pathfinder@localhost:5432/pathfinder",
  AUTH_SECRET: "a-long-enough-development-secret",
};

describe("parseConfig", () => {
  it("treats empty strings as not set, so blank keys mean mocks", () => {
    const config = parseConfig({ ...base, GEMINI_API_KEY: "", AUTH_GOOGLE_ID: "  ", S3_BUCKET: "" });
    expect(config.GEMINI_API_KEY).toBeUndefined();
    expect(config.AUTH_GOOGLE_ID).toBeUndefined();
    expect(config.S3_BUCKET).toBeUndefined();
    expect(config.GEMINI_MODEL).toBe("gemini-flash-latest");
    expect(config.STORAGE_DRIVER).toBe("local");
    expect(config.APP_URL).toBe("http://localhost:3000");
  });

  it("refuses to start without a database or with a short secret", () => {
    expect(() => parseConfig({ AUTH_SECRET: base.AUTH_SECRET })).toThrow(/DATABASE_URL/);
    expect(() => parseConfig({ ...base, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
  });

  it("takes the fallback model only as a complete set, and the rate limits with brief §7 defaults", () => {
    expect(() => parseConfig({ ...base, FALLBACK_AI_API_KEY: "k" })).toThrow(/set all three FALLBACK_AI_\* values/);
    expect(() =>
      parseConfig({ ...base, FALLBACK_AI_BASE_URL: "not a url", FALLBACK_AI_API_KEY: "k", FALLBACK_AI_MODEL: "m" }),
    ).toThrow(/FALLBACK_AI_BASE_URL/);
    const full = parseConfig({ ...base, FALLBACK_AI_BASE_URL: "https://ai.example/v1", FALLBACK_AI_API_KEY: "k", FALLBACK_AI_MODEL: "m" });
    expect(full.FALLBACK_AI_MODEL).toBe("m");
    const defaults = parseConfig(base);
    expect(defaults.FALLBACK_AI_BASE_URL).toBeUndefined();
    expect(defaults.RATE_LIMIT_API_PER_MINUTE).toBe(60);
    expect(defaults.RATE_LIMIT_SIGNIN_PER_MINUTE).toBe(10);
    expect(defaults.TRUSTED_PROXY_HOPS).toBe(1);
  });

  it("requires bucket and keys when storage is S3", () => {
    expect(() => parseConfig({ ...base, STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET[\s\S]*S3_ACCESS_KEY[\s\S]*S3_SECRET_KEY/);
  });

  it("refuses unsafe production settings", () => {
    const error = (() => {
      try {
        parseConfig({ ...base, NODE_ENV: "production", AUTH_SECRET: "change-me-change-me" });
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect(error?.message).toMatch(/AUTH_GOOGLE_ID/);
    expect(error?.message).toMatch(/STORAGE_DRIVER must be s3 in production/);

    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: "production",
        AUTH_SECRET: "change-me",
      }),
    ).toThrow(/AUTH_SECRET/);
  });

  it("accepts a complete production configuration", () => {
    const config = parseConfig({
      ...base,
      NODE_ENV: "production",
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "secret",
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "b",
      S3_ACCESS_KEY: "k",
      S3_SECRET_KEY: "s",
    });
    expect(config.NODE_ENV).toBe("production");
  });

  it("never puts values in error messages", () => {
    const secrets = ["postgres-password-xyz", "AIzaSy-gemini-key-123", "s3-secret-value-456"];
    try {
      parseConfig({
        DATABASE_URL: `postgresql://u:${secrets[0]}@db/x`,
        AUTH_SECRET: "tiny",
        GEMINI_API_KEY: secrets[1],
        STORAGE_DRIVER: "s3",
        S3_SECRET_KEY: secrets[2],
        APP_URL: "not a url",
        NODE_ENV: "production",
      });
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toMatch(/AUTH_SECRET/);
      expect(message).toMatch(/APP_URL/);
      for (const s of [...secrets, "tiny", "not a url"]) expect(message).not.toContain(s);
    }
  });
});

describe("isDevSignInEnabled", () => {
  it("is on in development only while Google sign-in is not configured", () => {
    expect(isDevSignInEnabled(parseConfig(base))).toBe(true);
    expect(isDevSignInEnabled(parseConfig({ ...base, AUTH_GOOGLE_ID: "id" }))).toBe(false);
  });

  it("is never on in production", () => {
    const prod = parseConfig({
      ...base,
      NODE_ENV: "production",
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "s",
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "b",
      S3_ACCESS_KEY: "k",
      S3_SECRET_KEY: "s",
    });
    expect(isDevSignInEnabled(prod)).toBe(false);
    expect(isDevSignInEnabled({ ...prod, AUTH_GOOGLE_ID: undefined })).toBe(false);
  });
});

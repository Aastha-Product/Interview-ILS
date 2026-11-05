import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  configProblems,
  isDemoSignInEnabled,
  isDevSignInEnabled,
  parseConfig,
  runsJobsInline,
} from "../src/config";
import { renderResumePdf, toPdfText } from "../src/pdf/resume-pdf";
import { sampleResume } from "./resume-html.test";

const prodDemo = {
  NODE_ENV: "production",
  APP_ENV: "demo",
  DATABASE_URL: "postgresql://u:p@db.example.test/neondb",
  AUTH_SECRET: "a-long-enough-production-secret",
  DEMO_PASSWORD: "let-me-in-please",
};

describe("demo configuration", () => {
  it("runs in production without Google sign-in or S3, with files in the database", () => {
    const config = parseConfig(prodDemo);
    expect(config.STORAGE_DRIVER).toBe("database");
    expect(isDemoSignInEnabled(config)).toBe(true);
    expect(isDevSignInEnabled(config)).toBe(false);
    expect(runsJobsInline(config)).toBe(true);
  });

  it("needs a demo password of at least 8 characters", () => {
    expect(() => parseConfig({ ...prodDemo, DEMO_PASSWORD: "" })).toThrow(
      /DEMO_PASSWORD is required in demo mode/,
    );
    expect(() => parseConfig({ ...prodDemo, DEMO_PASSWORD: "short" })).toThrow(ConfigError);
  });

  it("still refuses the example AUTH_SECRET and local files on a demo site", () => {
    expect(() => parseConfig({ ...prodDemo, AUTH_SECRET: "change-me" })).toThrow(/AUTH_SECRET/);
    expect(() => parseConfig({ ...prodDemo, STORAGE_DRIVER: "local" })).toThrow(
      /must be database or s3 on a demo site/,
    );
  });

  it("keeps the normal production rules for every other site", () => {
    const { DEMO_PASSWORD: _unused, ...rest } = prodDemo;
    void _unused;
    expect(() => parseConfig({ ...rest, APP_ENV: "staging" })).toThrow(
      /Google sign-in must be configured/,
    );
    expect(() => parseConfig({ ...rest, APP_ENV: "staging", STORAGE_DRIVER: "database" })).toThrow(
      /only for demo sites/,
    );
    expect(
      runsJobsInline(
        parseConfig({
          DATABASE_URL: "postgresql://x@y/z",
          AUTH_SECRET: "a-long-enough-development-secret",
        }),
      ),
    ).toBe(false);
  });

  it("uses the names Vercel gives the database and site address", () => {
    const { DATABASE_URL: _url, ...rest } = prodDemo;
    void _url;
    const config = parseConfig({
      ...rest,
      POSTGRES_PRISMA_URL: "postgresql://from@vercel/db",
      VERCEL_PROJECT_PRODUCTION_URL: "my-site.vercel.app",
    });
    expect(config.DATABASE_URL).toBe("postgresql://from@vercel/db");
    expect(config.APP_URL).toBe("https://my-site.vercel.app");
    expect(parseConfig({ ...prodDemo, APP_URL: "https://custom.example.test" }).APP_URL).toBe(
      "https://custom.example.test",
    );
  });
});

describe("renderResumePdf (no browser)", () => {
  it("produces a real PDF", async () => {
    const bytes = await renderResumePdf(sampleResume());
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("swaps characters the built-in font can't draw instead of failing", async () => {
    expect(toPdfText("“Quoted” – ₹3 LPA • Pune…")).toBe('"Quoted" - Rs.3 LPA - Pune...');
    expect(toPdfText("नमस्ते Asha")).toBe("Asha");
    const resume = sampleResume({ headline: "QA • “fresher” – ₹3 LPA ✓ 🚀" });
    await expect(renderResumePdf(resume)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("flows long content onto more pages", async () => {
    const long = sampleResume();
    long.projects = Array.from({ length: 12 }, (_, i) => ({
      sourceId: `proj:${i}`,
      name: `Project ${i}`,
      role: "",
      technologies: ["Java"],
      url: "",
      dates: "2025",
      bullets: Array.from({ length: 6 }, (_, j) => ({
        id: `b${i}-${j}`,
        text: `Point ${j} `.repeat(20),
        factIds: [],
      })),
    }));
    const one = await renderResumePdf(sampleResume());
    const many = await renderResumePdf(long);
    expect((await PDFDocument.load(one)).getPageCount()).toBe(1);
    expect((await PDFDocument.load(many)).getPageCount()).toBeGreaterThan(2);
  });
});

describe("configProblems (for the health check)", () => {
  it("names missing or wrong settings without their values", () => {
    expect(configProblems(prodDemo)).toEqual([]);
    const problems = configProblems({
      ...prodDemo,
      DEMO_PASSWORD: "",
      AUTH_SECRET: "short",
      DATABASE_URL: "",
    });
    expect(problems.sort()).toEqual(["AUTH_SECRET", "DATABASE_URL", "DEMO_PASSWORD"]);
    expect(JSON.stringify(problems)).not.toContain("short");
    expect(configProblems({ ...prodDemo, APP_ENV: "demoo" })).toEqual(["APP_ENV"]);
  });
});

import { describe, expect, it } from "vitest";
import { dedupeKey, normaliseCompany, normaliseLocation, normaliseQuery, normaliseTitle, normaliseUrl } from "../src/normalise";

describe("normaliseUrl", () => {
  it("strips tracking parameters, www, the fragment and the trailing slash, and forces https", () => {
    expect(
      normaliseUrl("http://WWW.Careers.Example.com/jobs/qa-1/?utm_source=google&utm_medium=x&gclid=abc&fbclid=z#apply"),
    ).toBe("https://careers.example.com/jobs/qa-1");
  });

  it("keeps meaningful parameters, sorted, so the same posting matches regardless of order", () => {
    const a = normaliseUrl("https://jobs.example.com/view?jobId=42&lang=en&utm_campaign=c");
    const b = normaliseUrl("https://jobs.example.com/view?lang=en&jobId=42&trk=feed");
    expect(a).toBe("https://jobs.example.com/view?jobId=42&lang=en");
    expect(b).toBe(a);
  });

  it("drops default ports and credentials", () => {
    expect(normaliseUrl("https://user:pw@example.com:443/a")).toBe("https://example.com/a");
  });

  it("rejects non-web and malformed URLs", () => {
    expect(normaliseUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseUrl("ftp://example.com/x")).toBeNull();
    expect(normaliseUrl("not a url")).toBeNull();
  });
});

describe("dedupe key", () => {
  it("treats company suffixes, title notes and city aliases as the same job", () => {
    const a = dedupeKey({ company: "Example Softech Pvt Ltd", title: "QA Engineer (Fresher)", location: "Bangalore, Karnataka" });
    const b = dedupeKey({ company: "Example Softech", title: "QA Engineer", location: "Bengaluru, Karnataka" });
    expect(a).toBe(b);
    expect(a).toBe("example softech|qa engineer|bengaluru");
  });

  it("keeps different cities and titles apart", () => {
    const base = { company: "Nimbus Analytics", title: "Junior Data Analyst", location: "Pune" };
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, location: "Mumbai" }));
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, title: "Senior Data Analyst" }));
  });

  it("normalises the parts", () => {
    expect(normaliseCompany("Konkan Fintech Private Limited")).toBe("konkan fintech");
    expect(normaliseCompany("Tata & Sons Ltd.")).toBe("tata and sons");
    expect(normaliseTitle("Software Engineer Trainee (2026 Batch)")).toBe("software engineer trainee");
    expect(normaliseLocation("Gurgaon / Delhi NCR")).toBe("gurugram");
    expect(normaliseLocation("")).toBe("");
    expect(normaliseQuery("  QA   Tester!! ")).toBe("qa tester");
  });
});

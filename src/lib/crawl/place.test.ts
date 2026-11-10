import { describe, expect, it } from "vitest";

import { countriesIn, countryCode, relevant } from "./place";
import { dedupeKey, escapedHtmlToText, htmlToText } from "./text";

describe("where a job is (auto-apply step 2)", () => {
  it("finds countries and Indian cities in a place", () => {
    expect(countriesIn("Bengaluru, Karnataka")).toEqual(["in"]);
    expect(countriesIn("Gurugram · Noida")).toEqual(["in"]);
    expect(countriesIn("Remote - United States or India")).toEqual(expect.arrayContaining(["us", "in"]));
    expect(countriesIn("London, UK")).toEqual(["gb"]);
    expect(countriesIn("São Paulo, Brazil")).toEqual(["br"]);
    expect(countriesIn("Remote")).toEqual([]);
    expect(countriesIn("")).toEqual([]);
  });

  it("reads a board's country field as a code or a name", () => {
    expect(countryCode("IN")).toBe("in");
    expect(countryCode("India")).toBe("in");
    expect(countryCode("European Union")).toBe("");
    expect(countryCode(null)).toBe("");
  });

  it("keeps jobs in the target countries, and remote jobs open everywhere or in our region", () => {
    const targets = ["in"];
    expect(relevant({ countries: ["in"], remote: null, location: "Pune" }, targets)).toBe(true);
    expect(relevant({ countries: ["us", "in"], remote: true, location: "US or India" }, targets)).toBe(true);
    expect(relevant({ countries: ["us"], remote: null, location: "New York" }, targets)).toBe(false);
    expect(relevant({ countries: [], remote: true, location: "Remote - Worldwide" }, targets)).toBe(true);
    expect(relevant({ countries: [], remote: true, location: "Remote, APAC" }, targets)).toBe(true);
    // A plain "Remote" from a US company usually means the US.
    expect(relevant({ countries: [], remote: true, location: "Remote" }, targets)).toBe(false);
    expect(relevant({ countries: [], remote: null, location: "Anywhere" }, targets)).toBe(false);
  });
});

describe("descriptions as text (auto-apply step 2)", () => {
  it("keeps paragraphs and list items", () => {
    expect(htmlToText("<h2>About</h2><p>We build&nbsp;things.</p><ul><li>One</li><li>Two</li></ul><p>Line<br>break</p>")).toBe(
      "About\n\nWe build things.\n\n- One\n- Two\n\nLine\nbreak",
    );
    expect(htmlToText(null)).toBe("");
  });

  it("reads Greenhouse's escaped HTML", () => {
    expect(escapedHtmlToText("&lt;p&gt;Fish &amp;amp; chips&lt;/p&gt;")).toBe("Fish & chips");
  });

  it("gives the same job the same key, however it's written", () => {
    const a = dedupeKey({ companyName: "Acme Pvt. Ltd.", title: "Software  Engineer", location: "Bengaluru" });
    const b = dedupeKey({ companyName: "acme pvt ltd", title: "software engineer", location: "BENGALURU" });
    expect(a).toBe(b);
    expect(dedupeKey({ companyName: "Acme", title: "Software Engineer", location: "Pune" })).not.toBe(
      dedupeKey({ companyName: "Acme", title: "Software Engineer", location: "Bengaluru" }),
    );
  });
});

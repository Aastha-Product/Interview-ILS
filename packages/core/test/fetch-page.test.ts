import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchJobPage, isAllowedByRobots, isPublicAddress } from "../src/jobs/fetch-page";
import { htmlToText, parsePostingHtml } from "../src/jobs/posting";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["8.8.8.8", "142.250.183.14", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );

  it("rejects things that are not IP addresses", () => expect(isPublicAddress("example.com")).toBe(false));
});

describe("robots.txt", () => {
  const robots = `
User-agent: *
Disallow: /jobs/
Allow: /jobs/public/
Disallow: /*.pdf$

User-agent: PathfinderBot
User-agent: OtherBot
Disallow: /private
`;
  it("uses our own group when one names us", () => {
    expect(isAllowedByRobots(robots, "/jobs/123")).toBe(true);
    expect(isAllowedByRobots(robots, "/private/x")).toBe(false);
  });
  it("falls back to * and applies the longest match", () => {
    expect(isAllowedByRobots(robots, "/jobs/123", "SomeoneElse")).toBe(false);
    expect(isAllowedByRobots(robots, "/jobs/public/123", "SomeoneElse")).toBe(true);
    expect(isAllowedByRobots(robots, "/files/a.pdf", "SomeoneElse")).toBe(false);
    expect(isAllowedByRobots(robots, "/files/a.pdf?x=1", "SomeoneElse")).toBe(true);
  });
  it("allows everything for an empty Disallow or no rules", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow:", "/anything")).toBe(true);
    expect(isAllowedByRobots("", "/anything")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /", "/anything")).toBe(false);
  });
});

describe("parsePostingHtml", () => {
  it("prefers schema.org JobPosting JSON-LD, including inside @graph", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "x" },
        {
          "@type": "JobPosting",
          title: "QA Engineer &amp; Tester",
          hiringOrganization: { "@type": "Organization", name: "Example Softech" },
          jobLocation: [{ "@type": "Place", address: { addressLocality: "Pune", addressRegion: "MH" } }],
          employmentType: ["FULL_TIME"],
          datePosted: "2026-10-20",
          description: "<p>We need a <b>fresher</b> QA engineer.</p><ul><li>Selenium</li><li>SQL</li></ul>" + "<p>More detail.</p>".repeat(5),
        },
      ],
    })}</script></head><body>ignored</body></html>`;
    const posting = parsePostingHtml(html, "https://careers.example.test/jobs/1");
    expect(posting.via).toBe("json-ld");
    expect(posting.title).toBe("QA Engineer & Tester");
    expect(posting.company).toBe("Example Softech");
    expect(posting.location).toBe("Pune, MH");
    expect(posting.employmentType).toBe("FULL_TIME");
    expect(posting.description).toContain("• Selenium");
    expect(posting.postedAt?.toISOString().slice(0, 10)).toBe("2026-10-20");
  });

  it("falls back to visible text without scripts, styles or navigation", () => {
    const html = `<html><head><title>Data Analyst | Acme</title><meta property="og:site_name" content="Acme Careers"></head>
      <body><nav>Menu Home Login</nav><main><h1>Data Analyst</h1><p>Use SQL &amp; Excel.</p><script>alert(1)</script></main><footer>©</footer></body></html>`;
    const posting = parsePostingHtml(html, "https://acme.example.test/jobs/2");
    expect(posting.via).toBe("html");
    expect(posting.title).toBe("Data Analyst | Acme");
    expect(posting.company).toBe("Acme Careers");
    expect(posting.description).toBe("Data Analyst\nUse SQL & Excel.");
  });

  it("htmlToText decodes numeric entities", () => {
    expect(htmlToText("<p>&#8377;3 LPA &#x2013; Pune</p>")).toBe("₹3 LPA – Pune");
  });
});

describe("fetchJobPage", () => {
  let server: http.Server;
  let base: string;
  const hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("User-agent: *\nDisallow: /blocked\n");
      } else if (req.url === "/job") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body><main>Job text</main></body></html>");
      } else if (req.url === "/redirect-private") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
      } else if (req.url === "/pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF");
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("x".repeat(3 * 1024 * 1024));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const opts = { allowLoopbackForTests: true };

  it("refuses private addresses unless the test-only flag is set", async () => {
    // The local server's port isn't 80/443, so use a private IP on a normal port instead.
    await expect(fetchJobPage("http://127.0.0.1/job")).rejects.toMatchObject({ kind: "blocked_address" });
    await expect(fetchJobPage("http://169.254.169.254/latest/meta-data/")).rejects.toMatchObject({ kind: "blocked_address" });
    await expect(fetchJobPage("http://localhost/job")).rejects.toMatchObject({ kind: "blocked_address" });
    await expect(fetchJobPage("ftp://example.com/job")).rejects.toMatchObject({ kind: "bad_url" });
    await expect(fetchJobPage("https://user:pw@example.com/job")).rejects.toMatchObject({ kind: "bad_url" });
  });

  it("rejects unusual ports outside tests", async () => {
    await expect(fetchJobPage("http://example.com:8080/job")).rejects.toMatchObject({ kind: "bad_url" });
  });

  it("checks robots.txt first, then fetches an allowed page", async () => {
    hits.length = 0;
    const page = await fetchJobPage(`${base}/job`, opts);
    expect(page.body).toContain("Job text");
    expect(hits).toEqual(["/robots.txt", "/job"]);
  });

  it("does not fetch a page robots.txt disallows", async () => {
    hits.length = 0;
    await expect(fetchJobPage(`${base}/blocked/1`, opts)).rejects.toMatchObject({ kind: "robots" });
    expect(hits).toEqual(["/robots.txt"]);
  });

  it("refuses a redirect to a private address", async () => {
    await expect(fetchJobPage(`${base}/redirect-private`, opts)).rejects.toMatchObject({ kind: "blocked_address" });
  });

  it("refuses non-HTML and oversized responses", async () => {
    await expect(fetchJobPage(`${base}/pdf`, opts)).rejects.toMatchObject({ kind: "content_type" });
    await expect(fetchJobPage(`${base}/big`, opts)).rejects.toMatchObject({ kind: "too_large" });
    await expect(fetchJobPage(`${base}/missing`, opts)).rejects.toMatchObject({ kind: "http" });
  });
});

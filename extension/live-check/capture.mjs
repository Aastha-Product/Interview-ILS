// A read-only look at the job boards' live application forms (Pathfinder auto-apply), run by
// hand, never in CI. The extension's board code was written from copies of three postings read
// on 10 November 2026; boards change their markup, and this checks it still reads today's.
//
//   node extension/live-check/capture.mjs D:\Pathfinder\tmp\live-forms
//   $env:PATHFINDER_LIVE_FORMS = "D:\Pathfinder\tmp\live-forms"
//   corepack yarn vitest run --project extension extension/live-check --silent=false
//
// It takes current postings from each company's public job-board API (as the crawler does),
// opens each application page in a headless Chromium without the extension, waits for the form,
// and saves the page as drawn. It never clicks, types, uploads or submits anything: no employer
// receives anything. A few pages per company, one at a time.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const out = process.argv[2];
if (!out) throw new Error("Usage: node extension/live-check/capture.mjs <folder for the pages>");

const PER_COMPANY = 2;
const COMPANIES = {
  greenhouse: ["zscaler", "hackerrank", "inmobi", "groww", "druva", "glance", "highradius"],
  lever: ["meesho", "paytm", "zeta", "cred", "mindtickle", "fampay"],
  ashby: ["tekion", "atlan", "notion", "sardine"],
};
/** Where each board's form is, as extension/src/boards.ts looks for it. */
const FORM = {
  greenhouse: "form#application-form, form#application_form, form.application--form",
  lever: "form#application-form, form.application-form",
  ashby: ".ashby-application-form-container",
};

const json = async (url) => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
};
const inIndiaFirst = (jobs, place) => [...jobs].sort((a, b) => Number(/india|bengaluru|bangalore|pune|hyderabad|mumbai|gurgaon|gurugram|noida|chennai|delhi/i.test(place(b))) - Number(/india|bengaluru|bangalore|pune|hyderabad|mumbai|gurgaon|gurugram|noida|chennai|delhi/i.test(place(a))));

async function postings() {
  const list = [];
  for (const token of COMPANIES.greenhouse) {
    try {
      const { jobs } = await json(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
      // As src/lib/apply/appliable.ts: only forms Greenhouse hosts itself.
      const hosted = jobs.filter((job) => /(^|\.)greenhouse\.io$/.test(new URL(job.absolute_url).hostname));
      for (const job of inIndiaFirst(hosted, (job) => job.location?.name ?? "").slice(0, PER_COMPANY)) {
        list.push({ board: "greenhouse", company: token, title: job.title, url: `https://job-boards.greenhouse.io/${token}/jobs/${job.id}` });
      }
    } catch (error) {
      console.log(`skip greenhouse ${token}: ${error.message}`);
    }
  }
  for (const token of COMPANIES.lever) {
    try {
      const jobs = await json(`https://api.lever.co/v0/postings/${token}?mode=json`);
      for (const job of inIndiaFirst(jobs, (job) => job.categories?.location ?? "").slice(0, PER_COMPANY)) {
        list.push({ board: "lever", company: token, title: job.text, url: job.applyUrl });
      }
    } catch (error) {
      console.log(`skip lever ${token}: ${error.message}`);
    }
  }
  for (const token of COMPANIES.ashby) {
    try {
      const { jobs } = await json(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
      for (const job of inIndiaFirst(jobs, (job) => job.location ?? "").slice(0, PER_COMPANY)) {
        list.push({ board: "ashby", company: token, title: job.title, url: job.applyUrl });
      }
    } catch (error) {
      console.log(`skip ashby ${token}: ${error.message}`);
    }
  }
  return list;
}

await mkdir(out, { recursive: true });
const pages = await postings();
console.log(`${pages.length} postings`);
const browser = await chromium.launch();
const context = await browser.newContext({ locale: "en-IN", timezoneId: "Asia/Kolkata", viewport: { width: 1280, height: 900 } });
const index = [];
for (const [n, posting] of pages.entries()) {
  const page = await context.newPage();
  const file = `${String(n + 1).padStart(2, "0")}-${posting.board}-${posting.company}.html`;
  let found = false;
  try {
    await page.goto(posting.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    found = await page.waitForSelector(FORM[posting.board], { timeout: 20_000 }).then(() => true, () => false);
    // Drop-downs and the like finish drawing after the form appears.
    await page.waitForTimeout(2000);
    await writeFile(join(out, file), await page.content());
  } catch (error) {
    console.log(`fail ${posting.url}: ${error.message.split("\n")[0]}`);
  }
  index.push({ ...posting, file, finalUrl: page.url(), formFound: found });
  console.log(`${found ? "form" : "NO FORM"}  ${posting.board}  ${posting.company}  ${posting.title}`);
  await page.close();
}
await browser.close();
await writeFile(join(out, "index.json"), `${JSON.stringify(index, null, 2)}\n`);

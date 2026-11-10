# Pathfinder extension

Auto-apply, steps 5 and 6. This Chrome extension (Manifest V3) submits the applications Pathfinder prepared. It runs in the student's own Chrome, signed in as them, and stays within the limits they set on the Auto-apply page.

## Try it

```bash
yarn extension:build        # writes extension/dist
```

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick `extension/dist`.
2. In Pathfinder, go to **Auto-apply → Connect the extension** (`/auto-apply/extension`) and press **Connect it to my account**. The bridge only works on `pathfinderedtech.com`, `www.pathfinderedtech.com` and `http://localhost:3000`.
3. Keep **Dry run** on in Set up job search while trying it. The extension fills the form and stops before Submit. The application shows "Needs you" with the form left open in a tab.

## How it works

| Part | File | Runs |
| --- | --- | --- |
| Background worker | `src/background.ts` (entry `src/worker.ts`) | Every minute: if connected and idle, leases the next application (`POST /api/ext/lease`), opens the job in a background tab, and injects the apply script on each page load there. It's the only part that calls Pathfinder: the tab asks it for answers, PDFs and reports. |
| Apply script | `src/run.ts` (entry `src/apply.ts`) | In the job's tab. It finds the form and fills in the server's answers. It asks the server about required questions its copy lacked, such as demographics or a consent box. Then it stops for anything only the student can do. Otherwise it reports *submitting*, presses Submit once, and reports only what the page shows. |
| Job boards | `src/boards.ts`, `src/form.ts`, `src/fill.ts` | `boards.ts` describes where each board's form is and what its questions look like; `form.ts` reads, fills and checks them the same way for all three.<br>**Greenhouse** (`job-boards.greenhouse.io`): ids are the API's field names, drop-downs are react-select.<br>**Lever** (`jobs.lever.co`): named controls, ✱ for required. The resume goes in first because Lever fills fields from it.<br>**Ashby** (`jobs.ashbyhq.com`): `data-field-path` entries, Yes/No buttons and a location autocomplete. PDFs are attached through `DataTransfer`. |
| Bridge | `src/bridge.ts` | On Pathfinder's page: answers the page's ping and passes the token to the worker. It never sends the token back to the page. |

## Safety rules (tested)

- **Never twice.** Submit is pressed only after Pathfinder accepts *submitting*. From then on, the application is never handed out again. If the page doesn't confirm, the application becomes "Check this one" (UNCERTAIN), not a retry.
- **Applied means confirmed.** "Applied" is reported only when the board's confirmation appears, and its words are kept as evidence.
- **The student finishes what only they can do.** Puzzles (a visible reCAPTCHA, hCaptcha or Cloudflare check), emailed codes, unanswered required questions and form errors all leave the form filled and open for the student. Nothing is ever bypassed.
- **Other pages are left alone.** Companies that move Greenhouse's form to their own site are handed to the student and nothing is filled.
- **Only the opened tab is answered.** The worker answers only the tab it opened for the current application, and accepts a token only from Pathfinder's own page.

## Tests

- **`yarn vitest run --project extension`** runs the unit tests (jsdom). They use copies of each board's markup, read from real postings on 10 November 2026 (Greenhouse: Zscaler; Lever: Meesho; Ashby: Tekion).
- **`yarn test:extension`** runs the Chrome tests (`e2e/extension.spec.ts`). It builds `dist-test`, which also talks to a fake Pathfinder on `localhost:4319`, and loads it in Chromium.
  - The mock boards include Greenhouse built with the **real react-select**.
  - The boards' hostnames resolve to a local HTTPS server, and **every other hostname to nothing**, so these tests never reach a real job board.
  - The fake Pathfinder answers forms with the **real answer rules** (`src/lib/apply/answers.ts`).
  - The first time, run `yarn playwright install chromium`. The tests also need `openssl` on PATH, or Git for Windows' copy.
- **`PATHFINDER_LOAD_TEST=1`** runs the load test (`src/lib/apply/load.db.test.ts`), on request only. Many students, two browsers each, go through the real routes; `PATHFINDER_LOAD_STUDENTS` sets how many.

## Dry-run pilot (before switching dry run off for anyone)

1. **You first.** On your own account, with Dry run on, let it prepare 10–20 applications. Open each "Needs you" tab and check every filled field against what you'd answer yourself. Note anything wrong.
2. **A few students.** Then 3–5 students who agree to it, still in dry run, for a week. Ask them to screenshot anything filled wrongly.
3. **Submitting, small.** Then dry run off for those students only, with the daily limit at 3. Check that each "Applied" shows in the company's confirmation email.
4. **Widen slowly,** and only after the consent wording has had its legal review.

## Not yet

- **Questions with several inputs:** for example, Ashby's education history. These go to the student when required.
- **Real boards may differ from the copies.** A board can change its markup, so the pilot is the real check. Anything it shows is fixed in `boards.ts`, with a copy of the new markup in `src/test`.
- **Chrome Web Store listing:** needs the owner's developer account and a privacy policy for the store.

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
| Popup | `popup.html`, `src/popup.ts` | Behind the icon: whose account this browser applies for and what it's doing now. **Pause in this browser** starts nothing new (an application under way finishes); **Open Auto-apply**, or **Connect** when not connected. |
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

## Check today's live forms (by hand)

`extension/live-check/` reads live application forms without touching them. It checks that the board code still reads today's markup, and shows how much the answer rules answer.

```powershell
node extension/live-check/capture.mjs D:\Pathfinder	mp\live-forms
$env:PATHFINDER_LIVE_FORMS = "D:\Pathfinder	mp\live-forms"
corepack yarn vitest run --project extension extension/live-check --silent=false
```

- `capture.mjs` takes 2 current postings from each company's public job-board API, opens each application page in a headless Chromium **without the extension**, and saves it once the form appears. It never clicks, types, uploads or submits.
- The test runs `boards.ts` and the server's answer rules on the saved pages, for a made-up student. It prints one line per form: questions, required ones answered, what goes to the student, and anything the board code misread. The report goes to `report.json` in the same folder.
- **11 November 2026, 30 forms** (10 Greenhouse, 12 Lever, 8 Ashby):
  - Every form, Submit button, resume input and question wording was read.
  - The answer rules then learned the wording for: present or fixed CTC, salary ranges, compensation expectations, present location, "earliest you can join", "experience in number of years", "currently a <company> employee" and "based out of <city>".
  - **6 of 30 forms are answered completely.** The rest each leave 1–7 questions to the student: job-specific experience, essays, office or shift commitments, Aadhaar name, nationality, Ashby's education history. These are what only the student can answer.

## Dry-run pilot (before switching dry run off for anyone)

1. **You first.** On your own account, with Dry run on, let it prepare 10–20 applications. Open each "Needs you" tab and check every filled field against what you'd answer yourself. Note anything wrong.
2. **A few students.** Then 3–5 students who agree to it, still in dry run, for a week. Ask them to screenshot anything filled wrongly.
3. **Submitting, small.** Then dry run off for those students only, with the daily limit at 3. Check that each "Applied" shows in the company's confirmation email.
4. **Widen slowly,** and only after the consent wording has had its legal review.

## Not yet

- **Questions with several inputs:** for example, Ashby's education history. These go to the student when required.
- **Real boards may differ from the copies.** A board can change its markup, so the pilot is the real check. Anything it shows is fixed in `boards.ts`, with a copy of the new markup in `src/test`.
- **Chrome Web Store listing:** needs the owner's developer account and a privacy policy for the store.
- **A Pathfinder logo:** the icons (`icons/`, made from `src/app/icon.svg` by `icons/make-icons.mjs`) are the site's own tab icon, still the "D" inherited from Dossier. Change both together.

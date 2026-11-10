# Pathfinder extension

Auto-apply, step 5b. This Chrome extension (Manifest V3) submits the applications Pathfinder prepared. It runs in the student's own Chrome, signed in as them, and stays within the limits they set on the Auto-apply page.

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
- **Applied means confirmed.** "Applied" is reported only when Greenhouse's confirmation appears, and its words are kept as evidence.
- **The student finishes what only they can do.** Puzzles (a visible reCAPTCHA, hCaptcha or Cloudflare check), emailed codes, unanswered required questions and form errors all leave the form filled and open for the student. Nothing is ever bypassed.
- **Other pages are left alone.** Companies that move Greenhouse's form to their own site are handed to the student and nothing is filled.
- **Only the opened tab is answered.** The worker answers only the tab it opened for the current application, and accepts a token only from Pathfinder's own page.

## Not yet

- **Testing in real Chrome:** the form filling is tested against copies of each board's markup, read from real postings on 10 November 2026 (Greenhouse: Zscaler; Lever: Meesho; Ashby: Tekion). Step 6 runs it in Chrome against mock job boards, then a dry-run pilot. Greenhouse's react-select and Ashby's autocomplete may still need adjusting then.
- **Questions with several inputs:** for example, Ashby's education history. These go to the student when required.
- **Chrome Web Store listing:** needs the owner's developer account and a privacy policy for the store.

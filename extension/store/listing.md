# Chrome Web Store listing

What to enter in the Chrome Web Store's developer dashboard for the Pathfinder extension. Keep it in step with `extension/manifest.json` and the privacy notice's section 7 (`src/app/privacy/page.tsx`). The reviewers compare all three.

**Package:** `yarn extension:package` writes `extension/release/pathfinder-extension-<version>.zip`. That build has no `localhost` address in it (tested in `extension/build.test.ts`). Raise `version` in `extension/manifest.json` before each upload.

## Before the first upload (owner)

- [ ] A Chrome Web Store developer account for the organisation (one-time fee), with a verified contact email.
- [ ] A Pathfinder icon. `extension/icons/` still has Dossier's "D". The store needs the 128×128 icon, plus a 440×280 promo tile.
- [ ] The privacy notice's contacts filled in (`src/lib/privacy.ts`), and the notice and the auto-apply consent (`CONSENT_TEXT` in `src/lib/apply/settings.ts`) reviewed by a lawyer.
- [ ] Screenshots, 1280×800 (see below), taken once the icon is final.
- [ ] A test account for the reviewers (see "Test instructions").
- [ ] Visibility: start as **Unlisted**, so only students with the link can install it, until the pilot is done.

## Store listing tab

**Name:** Pathfinder

**Summary** (132 characters at most; the manifest's description):

> Applies to the jobs Pathfinder prepared for you, from your own browser, within the limits you set.

**Category:** Productivity → Workflow & planning (or Tools)

**Language:** English

**Description:**

> Pathfinder helps students and recent graduates find and apply for jobs. This extension is the part that applies: it connects Chrome to your Pathfinder account and submits the applications Pathfinder prepared for you, in your own browser.
>
> How it works
> • In Pathfinder, set up Auto-apply: the roles you want, your limits per day and per company, and your answers to the questions forms often ask.
> • Connect the extension on Auto-apply → Connect the extension.
> • About once a minute, the extension asks Pathfinder for the next application that's ready. It opens the job's form in a background tab, fills it in with your answers, your tailored resume and your cover letter, and submits it.
> • Your dashboard shows each application as Applied (only once the job site confirms it), Needs you, or Check this one.
>
> You stay in charge
> • Auto-apply starts in dry run: it fills forms and stops before Submit, so you can check them first.
> • It never gets round a check that you're a person, a code sent to your email, or a sign-in. It leaves the form open for you to finish instead.
> • It never makes up an answer. A question it can't answer from your profile or your saved answers comes back to you.
> • It presses Submit at most once per application.
> • Pause it in this browser from its icon, switch auto-apply off in Pathfinder, or disconnect the browser at any time.
>
> Where it works
> Pathfinder's own site, and the application pages of Greenhouse, Lever and Ashby. It can't read any other site, your other tabs or your browsing history.
>
> You need a Pathfinder account to use it.

**Privacy policy URL:** https://pathfinderedtech.com/privacy

**Homepage URL:** https://pathfinderedtech.com

## Privacy practices tab

**Single purpose:**

> Submits the job applications that the student's Pathfinder account prepared, on the job boards' application pages, from the student's own browser.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `alarms` | Checks with Pathfinder about once a minute for the next application that's ready. The same check notices when a job's page never finished, so it can hand that application back. |
| `storage` | Keeps the key that connects the extension to the student's account, their name (shown in the popup), whether they paused it, and the application under way. Nothing else. |
| `scripting` | Runs the form-filling script in the tab the extension opened for an application, and only there, each time that tab loads a page. |
| Host `pathfinderedtech.com`, `www.pathfinderedtech.com` | Pathfinder's own site: the extension asks it for the next application and its answers, downloads the student's resume and cover letter, and reports what happened. The connect page there hands the extension its key. |
| Host `job-boards.greenhouse.io`, `boards.greenhouse.io` | Greenhouse's application forms, which the extension fills in and submits. |
| Host `jobs.lever.co`, `jobs.eu.lever.co` | Lever's application forms, likewise. |
| Host `jobs.ashbyhq.com` | Ashby's application forms, likewise. |

**Remote code:** No, I am not using remote code. All JavaScript is in the package. The extension only fetches data (JSON and PDF files) from Pathfinder.

**Data usage:** tick what the extension handles.

| Data type | Tick? | Why |
| --- | --- | --- |
| Personally identifiable information | Yes | It fills the student's name, email, phone number and similar into application forms. |
| Health information | No | |
| Financial and payment information | No | Salary expectations are typed by the student, not account or card data. |
| Authentication information | Yes | It keeps the key that connects it to the student's Pathfinder account. It never handles job-site passwords. |
| Personal communications | No | |
| Location | No | It doesn't read the device's location. A city typed into the profile counts as PII above. |
| Web history | No | It knows only the pages it opened for an application. |
| User activity | No | |
| Website content | Yes | It reads the application form's questions and the job site's confirmation message. |

**Certify:** tick all three.
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Screenshots (1280×800, up to 5)

Take them on a test account with Dry run on, once the icon is final:

1. The Auto-apply page: the switch, the limits and a few matched jobs.
2. Connect the extension: the connected browser listed.
3. The extension's popup, connected and applying ("Applying now: …").
4. A form in dry run: filled in, stopped before Submit, shown as "Needs you".
5. The dashboard: one Applied (with the confirmation), one Needs you.

Don't show a real student's data. Use the demo seed or a test profile.

## Test instructions (Distribution tab)

The reviewers need an account to see the extension work. Give them:

- A test Google account that's allowed to sign in to Pathfinder, with a filled-in profile and Auto-apply set up **in dry run**. Then nothing is ever submitted to a real employer during the review.
- Steps: sign in at https://pathfinderedtech.com, open Auto-apply → Connect the extension, press **Connect it to my account**, then open the extension's icon. Within a minute or two it opens a job's form in a background tab, fills it in and stops before Submit. The application shows "Needs you".

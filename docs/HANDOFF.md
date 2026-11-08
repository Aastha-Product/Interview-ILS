# Handoff

Read this first, update it last. Several Claude accounts work on Pathfinder from the same laptop and
the same folder, one at a time. This file is how one session tells the next what happened.

## Where things are

- **Repository:** https://github.com/Aastha-Product/Interview-ILS (`origin`). Push here.
- **Local folder:** `C:\Users\Aastha Pandey\Downloads\Deepa F\Pathfinder\code`, a link to
  `D:\Pathfinder\dossier` (the C: drive is full, so the code and its packages live on D:).
- **Other remotes:** `dossier-fork` (Aastha-Product/dossier, the earlier home of this code) and
  `upstream` (AienTech/dossier, the original project; pushing to it is disabled). The local branch
  `upstream-dossier-main` is upstream's `main`, kept for reference: never push it to `origin`.
- **Licence:** AGPL-3.0 (from Dossier). Keep the notices; the source stays public.
- **Rules and the remaining v1 tasks:** `docs/pathfinder-v1-plan.md`. Never automate job portals or
  scrape them, never invent experience, never log resume or prompt text, never commit secrets,
  don't deploy or use real API keys without asking.

## How every session works

1. **Start:** make sure no other account is working in this folder. Then `git status` (anything
   uncommitted? ask before touching it), `git fetch origin`, check out your branch and
   `git pull`, and read the latest entry below.
2. **Work on a branch,** never on `main`: one per task, from the latest `main`, named
   `fix/...`, `feature/...` or `chore/...`. Commit small, with clear messages.
3. **Before a pull request,** run the checks (below) and merge the latest `main` into your branch,
   so any conflicts are solved on the branch.
4. **Code reaches `main` only through a pull request** that passes CI, merged by the owner.
   Never force-push, never rewrite history, never push straight to `main`.
5. **End:** commit everything, push your branch, and add an entry at the top of the log below.
   Nothing stays only in the folder.

## Checks (Windows)

Use Yarn through corepack, and keep temp files on D: (C: is full):

```powershell
$env:COREPACK_HOME='D:\Pathfinder\.corepack'; $env:TEMP='D:\Pathfinder\tmp'; $env:TMP='D:\Pathfinder\tmp'
corepack yarn typecheck
corepack yarn lint
corepack yarn test
```

The database tests need `TEST_DATABASE_URL` set (it's in the local `.env`, which vitest doesn't
load by itself). The local Postgres runs on port 5432: start it from `D:\Pathfinder\pathfinder`
with `pnpm services:up`. Six tests in `env.test.ts` and `session-audit.test.ts` fail on Windows
only (path separators); everything else must pass. The browser tests (`yarn test:e2e`) don't run
on Windows yet; they need Linux or CI.

## Current state (7 November 2026)

| Branch | What it holds |
| --- | --- |
| `main` | **This app:** private student accounts, the QA fixes and the UI redesign (pull request #1, merged 7 November). Start every new branch from here. |
| `pathfinder-v1` | The earlier Pathfinder app (Next.js monorepo, Phases 1–5), kept for reference; also in `main`'s history. |
| `pathfinder-multiuser`, `pathfinder-redesign`, `release/new-main` | Merged into `main`; no new work here. |

Vercel (projects interview-ils-7cfy and resume-optimiser) still builds this repo and fails on the
new code, which has no `apps/web`: set their production branch to `pathfinder-v1` or disconnect
them. The app itself is deployed on AWS Lightsail (`docs/deploy-aws-lightsail.md`).

**Done:** QA audit (report: https://claude.ai/artifact/NszT6XWfFbikbb3syqmxZz) and fixes for
C-1 (shared AI key leak), C-2/H-2 (jobs stuck with two students, schedulers failing), H-1 (PDFs),
H-3 (sign-in lockout), M-3 (account deletion), M-4 (sign-out ends sessions). UI redesign on the
reference design (report: https://claude.ai/artifact/4DwdbGGvd2MtBhCryBeXPN).

**Open, in priority order:**

1. **Live server (owner, on AWS Lightsail):** switch sign-in from the shared access code to
   Firebase or Google (QA C-3), rotate the shared AI key, check the nightly backup log. The live
   server still runs an older build.
2. **C-3 in code:** refuse to start in production on the access code unless
   `PATHFINDER_SIGN_IN=code` is set; never let the code open an account linked to Google or
   Firebase. Started and stopped on 7 November at the owner's request: ask before resuming.
3. **M-6:** CI (`.github/workflows/ci.yml`) runs on every pull request, but it will be red until
   the 3 tests in `google-sign-in.test.ts` stop depending on env that CI doesn't set, and the
   browser tests are brought up to date with the student mode. Once it's green, make "CI passes"
   a required check on `main`. Also make the browser-test harness run on Windows.
4. **M-1:** several uploads at once by a new student fail (profile-fill race).
5. **M-2:** address guard for AI provider URLs; **M-5:** bind the Gmail OAuth state to the student.
6. Low items L-1 to L-8 in the QA report.
7. Before a public launch: legal review of the privacy notice (DPDP Act).

## Repository settings (done by the owner, 7 November 2026)

- Default branch: `main`.
- Ruleset **protect main** (active): pull request required (0 approvals), merge commits only,
  force pushes blocked, deletion blocked. "Require status checks" is off until CI is green (M-6);
  then turn it on and add the CI check.
- The previous `main` (Phases 1–5 monorepo) is kept as the branch `pathfinder-v1`.

## Log

Newest first. One entry per session: date, account, branch, what changed, what's next.

- **2026-11-08 · account 1 · `feature/managed-mode`** — P0 task 1 of the scale audit
  (https://claude.ai/artifact/GSHLW1T2jiX99CUiBtAUov): `PATHFINDER_MANAGED` (on by default). The
  AI, job search, scoring and Google client come only from the server's DOSSIER_* variables; what
  a student saved is ignored; their settings actions refuse; Settings hides AI provider, Job
  search, Scoring (and Google without a server client); "check your key / choose a provider"
  messages become plain ones, logged for the operator. Inherited tests run self-hosted
  (`PATHFINDER_MANAGED=off` in the test setup and e2e). Next, P0 task 2: show students the
  Dossier tools and enforce the tools gate on the server.

- **2026-11-07 · account 1 · `chore/handoff-after-merge`** — Merged pull request #1: `main` is now
  this app (old app kept as `pathfinder-v1`). Made the Pages workflow manual-only (site/ is
  upstream Dossier's website). Next: the open list above, starting with the live server (owner)
  and M-6 so CI goes green.

- **2026-11-07 · account 1 · `pathfinder-redesign`** — Checked Interview-ILS: default branch is
  `main`, the protect-main ruleset is active, all work is pushed. Next: the owner opens the pull
  request `release/new-main` → `main`
  (https://github.com/Aastha-Product/Interview-ILS/compare/main...release/new-main), sets Vercel's
  production branch to `pathfinder-v1` or disconnects it, and merges with "Create a merge commit".

- **2026-11-07 · account 1 · `pathfinder-redesign`** — Moved the work to Interview-ILS: pushed
  `pathfinder-multiuser` and `pathfinder-redesign`, made Interview-ILS `origin`, linked the code
  into the Pathfinder folder, added this file. Next: owner sets the GitHub default branch and the
  `main` protection rules, then merges the pull request that makes `pathfinder-redesign` the new
  `main`.

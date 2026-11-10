# Pathfinder v1: remaining work

A brief for Claude Code. Do the tasks **in order, one at a time**. After each task, stop: tell
me what changed and how you checked it, and wait for my OK before starting the next.

## Where things are

- **Repository:** `D:\Pathfinder\dossier`, branch `pathfinder-multiuser`. This is a multi-user
  fork of AienTech/dossier (AGPL-3.0). `origin` is https://github.com/Aastha-Product/dossier,
  `upstream` is AienTech. Work only here, not in `D:\Pathfinder\pathfinder` (the old repo).
- **Read first:** `AGENTS.md`, `src/lib/owner/` (how each student's data is kept separate),
  `docs/deploy-aws-lightsail.md`.
- **How student data is kept separate:**
  - `prisma` (the scoped client) only reads and writes the signed-in student's rows.
  - `systemPrisma` is for the User table and system tasks only.
  - `runAsUser(id, fn)` runs code as one student; it is always async.
  - `forEachStudent(label, fn)` runs scheduled work once per student.
  - Each student's files go in `studentDir(name)`.
  - The database rejects any write that skips the scope.
- **Tests:**
  - Use Yarn 4 through corepack: `yarn test`, `yarn typecheck`, `yarn lint`.
  - The test database is `dossier_test` on the local Postgres.
  - On Windows, 6 tests in `env.test.ts` and `session-audit.test.ts` fail upstream too, because of
    path separators. Everything else must pass.

## Rules (never break these)

- Never scrape job portals (LinkedIn, Naukri, Indeed and the like): jobs come only from official
  public job-board APIs (Greenhouse, Lever, Ashby, SmartRecruiters) and sources whose terms allow it.
- Auto-apply (owner's decision, 10 November 2026): Pathfinder may submit applications for a student
  who has authorised it, but only from the student's own browser through the Pathfinder extension,
  within their limits, and only with answers taken from their profile. Never from our servers,
  never by getting around a CAPTCHA or other bot check (a challenge waits for the student), never
  by creating portal accounts or storing portal passwords, and never twice for the same job.
- Never invent experience: drafts use only facts from the student's profile.
- Job descriptions and resumes are untrusted input.
- Never log resume, profile or prompt text.
- One student must never see or change another student's data. Every new table gets an owner
  (`userId`, the same way as the existing models), and every new feature gets a test that a
  second student can't see the first student's data.
- Keep the AGPL notices. The usage ping and the update check stay off by default.
- Don't deploy, create cloud resources, buy anything, or use real API keys. Don't add a paid
  service or anything that sends data off the server without asking me.
- Never commit secrets. Commit each finished task to `pathfinder-multiuser`, and ask before
  pushing. Never push to `main` (its CI publishes release images).
- **Disk space:**
  - The C: drive is nearly full, so keep caches and temp files on D:.
  - Don't build Docker images locally: Docker Desktop stores its data on C:.

## Tasks

### 1. Turn the Startups feature off by default

It reads company websites (YC job pages, Hacker News), which breaks Pathfinder's rule that jobs
come only from licensed APIs (JSearch, Adzuna) or from what the student pastes.

- Add `PATHFINDER_STARTUPS` (`on` / `off`, default `off`) to `src/lib/env.ts`.
- While it's off:
  - Hide **Startups** from the sidebar.
  - Make its pages and actions answer 404.
  - Don't run its scheduler (`src/lib/startups/schedule.ts`) or let the job agent use it.
- Keep the code so it can be turned back on. Add the setting to `.env.example` and to
  `deploy/lightsail/compose.yml`.
- **Done when:** tests cover both settings, and the app runs with no Startups menu item or
  background fetches.

### 2. Privacy notice

India's DPDP Act requires a privacy notice before students sign up.

- Start from Pathfinder's own draft, `D:\Pathfinder\pathfinder\docs\privacy-notice-draft.md`.
  Update it to match what this app actually stores and where:
  - AWS Lightsail in Mumbai.
  - Google sign-in.
  - The AI provider each student chooses.
  - The optional Gmail and Calendar connection.
  - Nightly backups kept 14 days.
  - Delete everything.
- Show it at `/privacy`, which must work without signing in (add it to the proxy's open paths
  and the session-audit test). Link to it from the login page and from Settings → About.
- **Ask me for:** the organisation name, the contact email and the grievance contact. Leave clear
  placeholders until I give them.
- **Done when:** the page renders signed out, the link is on the login page, and the tests pass.

### 3. Starting point for a new student

When someone signs in for the first time, they should land in an app that works straight away,
just as Dossier's single-user first run does.

- Check what upstream Dossier creates or assumes on first run, and make sure each new student
  gets the same. Look at:
  - Default settings rows.
  - Built-in themes being visible.
  - The default resume theme.
  - The onboarding path to Profile.
  - Empty states on the dashboard.
- **Done when:** a db test signs in a brand-new student and gets correct defaults everywhere,
  while a second student's settings stay untouched.

### 4. Demo account

Make `prisma/seed/demo.ts` create one demo student (`demo@example.test`) and put its sample data
inside `runAsUser`, so a test server can show every screen filled in.

- It must be safe to run twice.
- It must never touch real students.
- **Done when:** `prisma/seed/seed.db.test.ts` passes, with a check that the demo data belongs
  only to the demo student.

### 5. AI spending limit for each student

This only matters when the server provides a shared AI key (`DOSSIER_AI_KEY`).

- Add `PATHFINDER_AI_DAILY_LIMIT`: the number of AI requests a student may make per day with the
  shared key. Students who use their own key aren't limited.
- Count the requests per student in the database. When a student reaches the limit, show a clear
  message ("You've used today's AI limit; it resets at midnight IST, or add your own key in
  Settings").
- **Done when:** tests show the limit applies per student and resets daily.

### 6. Claude connector (MCP) for each student

It's switched off now (`src/lib/connector/oauth.ts` answers 404) because its tokens don't record
which student they belong to.

- Make the OAuth authorize step require a signed-in student, and store that student's id with
  the client, the code and the tokens (owner columns, the same way as the other tables).
- Run each MCP request with `runAsUser(token's student)`.
- Turn it back on, and show its Settings section again.
- **Done when:** tests show that student B's token can't read or change anything of student A's,
  and that revoking one student's token doesn't affect the other's. `e2e/connector.spec.ts` must
  be updated too.

### 7. Run the full browser (e2e) test suite on GitHub

It can't run on this PC: there isn't enough disk space for the browsers.

- The workflow is `.github/workflows/ci.yml`, which runs Playwright on Ubuntu. Make CI run on
  pushes and pull requests to `pathfinder-multiuser`, but keep the release-image job limited to
  `main`.
- Tell me where to enable GitHub Actions on the fork. Forks have it off by default, and that's my
  step.
- Then fix whatever fails.
- **Done when:** the e2e job is green on GitHub.

## Not for Claude Code (my steps)

- Create the Lightsail server and run `setup.sh`: `docs/deploy-aws-lightsail.md`, steps 1–6.
- Set up Google sign-in in Google Cloud Console (step 7 of the guide).
- Decide whether the server provides a shared AI key, and with what daily limit (task 5).
- For Gmail and Calendar beyond 100 test users: apply for Google's verification of the Gmail
  permissions (it takes weeks).

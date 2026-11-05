# Demo site on Vercel (Vercel alone, about 5 minutes)

A self-contained test site: only Vercel and Vercel's own Postgres. No worker, no S3, no Google
sign-in. Use it to try the whole flow (sign in, import a resume, add a job, tailored draft, PDF).
For the real staging or pilot setup (worker, S3, Google sign-in) see [deploy-vercel.md](deploy-vercel.md).

## What "demo mode" changes (`APP_ENV=demo`)

| Normally                                  | On a demo site                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A separate worker drafts and renders PDFs | Both run inside the website, right after it responds (up to 2 minutes)                                                                                |
| Files in S3                               | Files in the database (`StoredFile` table)                                                                                                            |
| Google sign-in                            | A demo sign-in: any email plus a shared **demo password**                                                                                             |
| PDFs rendered with Chromium               | PDFs rendered without a browser (same content and sections; the built-in PDF font can't draw scripts such as Devanagari or emoji, which are left out) |
| You run migrations                        | Migrations run automatically during each Vercel build                                                                                                 |

Every page shows a "Demo site: test data only" banner and asks search engines not to index it.
Anyone with the demo password can create an account, so share it only with your testers.

## Steps

1. **Database.** Vercel → project **interview-ils-7cfy** → **Storage** → **Create Database** →
   **Neon (Postgres)** → region **Singapore**, free plan → **Create**. When asked, connect it to the
   project for **Production** (and Preview if you like), and keep the default variable prefix. Vercel
   adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` itself; don't type them.
2. **Settings.** Project → **Settings → Environment Variables**, environment **Production**:

   | Name             | Value                                                                                               |
   | ---------------- | --------------------------------------------------------------------------------------------------- |
   | `APP_ENV`        | `demo`                                                                                              |
   | `DEMO_PASSWORD`  | a password you choose, 8+ characters, to give your testers                                          |
   | `AUTH_SECRET`    | output of `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`          |
   | `GEMINI_API_KEY` | optional: a key from aistudio.google.com for the real AI. Without it, a rule-based stand-in drafts. |

3. **Deploy.** Deployments → the latest one → **⋯ → Redeploy**. The build log shows
   `migrate-on-deploy: applying database migrations...` and then the usual Next.js build.
4. **Check.** Open `https://<your-site>/api/health`: it should say `{"status":"ok"}`. Then open the
   site, use **Demo sign-in** with any email and the demo password, upload a resume, paste a job,
   press **Start application**, wait for the draft, and download the PDF.

## Troubleshooting

| You see                                                                                                        | Fix                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Build fails with `migrate-on-deploy: no database is connected`                                                 | Do step 1, then redeploy.                                                          |
| Site shows "This page couldn't load" and the log says `Invalid configuration … DEMO_PASSWORD` or `AUTH_SECRET` | Add the setting from step 2 and redeploy (settings only apply to new deployments). |
| "That demo password isn't right."                                                                              | Check `DEMO_PASSWORD` in Vercel; it's case-sensitive.                              |
| A draft shows "failed"                                                                                         | Press **Try again**. With a real Gemini key a draft can take up to a minute.       |

## Moving to AWS later

The database is just `DATABASE_URL`. To use AWS RDS instead, create the database, set `DATABASE_URL`
(and `DATABASE_URL_UNPOOLED`) to its address in Vercel, remove the Neon connection, and redeploy:
migrations run on the new database during the build. For the full setup, switch `APP_ENV` to
`staging` and follow deploy-vercel.md.

# Staging on Vercel: step by step

The quickest way to a working staging site: the website on **Vercel**, the database on **Neon**, files on **AWS S3 (Mumbai)**, sign-in with **Google**, and the worker on **Render**. No code changes are needed. For running both containers on one host, or for production, see [deploy.md](deploy.md).

Every piece is required. On a live site the app refuses to start without a database, `AUTH_SECRET`, Google sign-in and S3 storage (the Vercel log then shows `Invalid configuration` and names what's missing). Without the worker, the site opens but drafts stay at "Drafting…" and no PDFs appear.

| Piece | Service | Cost (pilot) |
| --- | --- | --- |
| Website | Vercel, project root `apps/web`, branch `main` | Free (Hobby) |
| Database | Neon, PostgreSQL 17, Singapore | Free |
| Files | AWS S3, `ap-south-1` (Mumbai) | A few cents |
| Sign-in | Google OAuth client (any Google Cloud or Firebase project) | Free |
| Worker | Render background worker, `infra/Dockerfile.worker` | About $7/month |

Keep a private note open while you work and copy each value into it. Never paste a password, key or connection string into chat, an issue, a commit or a file in this repository: they go only into Vercel's and Render's settings.

## 1. GitHub and Vercel branches

1. GitHub → repository **Settings → General → Default branch** → `main`.
2. Vercel → project → **Settings → Environments → Production → Branch Tracking** → `main`.
3. Vercel → **Settings → Domains**: note the site address, e.g. `https://interview-ils-7cfy.vercel.app`. Below, this is **SITE**.

When importing the repository into Vercel, choose the **web** app (`apps/web`), not the repository root.

## 2. Database (Neon)

1. Sign up at [neon.tech](https://neon.tech).
2. Create a project: name `pathfinder-staging`, **Postgres 17**, region **AWS Asia Pacific (Singapore)**.
3. **Connect** → turn **Connection pooling off** (the address must not contain `-pooler`; the job queue needs a direct connection) → copy the connection string. This is **DATABASE_URL**.
4. Create the tables from your computer (PowerShell, in the repository folder):

   ```powershell
   $env:DATABASE_URL="PASTE_HERE"; pnpm db:deploy
   ```

   It ends with "All migrations have been successfully applied". Close the window afterwards. Run it again whenever a new migration is merged.

## 3. File storage (AWS S3, Mumbai)

1. Sign up at [aws.amazon.com](https://aws.amazon.com). Set a **budget alert** (Billing → Budgets) on day one.
2. **S3 → Create bucket**: a unique name such as `pathfinder-staging-<yourname>`, region **Asia Pacific (Mumbai) ap-south-1**, **Block all public access: on**. No CORS rules are needed.
3. **IAM → Users → Create user** `pathfinder-staging-app`, without console access.
4. On the user, **Add permissions → Create inline policy → JSON** (your bucket name in both places):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::YOUR-BUCKET/*" },
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::YOUR-BUCKET" }
     ]
   }
   ```

5. **Security credentials → Create access key → Application running outside AWS**. Copy the access key ID and the secret access key (shown once).

## 4. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com) (a Firebase project works), open **Google Auth Platform**: app name *Pathfinder*, your support email, audience **External**.
2. **Audience → Test users**: add every Google account that will try the site. While the app is in *Testing*, only these can sign in.
3. **Clients → Create client → Web application**:
   - Authorised JavaScript origin: `SITE`
   - Authorised redirect URI: `SITE/api/auth/callback/google`
4. Copy the client ID and client secret.

## 5. AUTH_SECRET

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 6. Vercel settings, then redeploy

Vercel → project → **Settings → Environment Variables**, environment **Production**:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | step 2 |
| `AUTH_SECRET` | step 5 |
| `AUTH_GOOGLE_ID` | step 4, client ID |
| `AUTH_GOOGLE_SECRET` | step 4, client secret |
| `APP_ENV` | `staging` |
| `APP_URL` | `SITE` |
| `TRUSTED_PROXY_HOPS` | `1` |
| `STORAGE_DRIVER` | `s3` |
| `S3_REGION` | `ap-south-1` |
| `S3_BUCKET` | your bucket name |
| `S3_ACCESS_KEY` | step 3, access key ID |
| `S3_SECRET_KEY` | step 3, secret access key |

Leave `S3_ENDPOINT` unset for AWS (it's only for other S3-compatible stores). Leave `GEMINI_API_KEY` empty to use the free mock AI, or add a paid-tier key. Leave the job-feed keys empty to use sample jobs.

Settings apply only to new deployments: **Deployments → latest → ⋯ → Redeploy**. The site now opens and Google sign-in works.

## 7. Worker (Render)

1. Sign up at [render.com](https://render.com) with GitHub and give it access to this repository.
2. **New → Background Worker**: branch `main`, runtime **Docker**, Dockerfile path `infra/Dockerfile.worker`, build context `.` (repository root), region **Singapore**, a plan with **at least 1 GB of memory** (Chromium).
3. **Environment**: the same settings as Vercel, plus `NODE_ENV=production`.
4. Create it. The logs show `Worker ready` after a few minutes.

## 8. Check it

1. `SITE/api/health` shows `{"status":"ok"}`.
2. `SITE` shows the amber **Staging site: test data only** banner.
3. Sign in with a test-user Google account, import a resume, paste a job, start an application, wait for the draft, download the PDF, press "I've applied", check the dashboard.

From now on, every push to `main` redeploys both the website (Vercel) and the worker (Render). Push only commits whose CI is green.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Vercel log: `Invalid configuration … DATABASE_URL / AUTH_SECRET … undefined` | Add the settings in step 6 and redeploy. |
| Vercel log: `AUTH_GOOGLE_ID Google sign-in must be configured` or `STORAGE_DRIVER must be s3` | Steps 3–4 and their settings are missing. |
| `/api/health` returns 503 | `DATABASE_URL` is wrong, or the migrations in step 2 weren't run. |
| Google says `redirect_uri_mismatch` | The redirect URI in step 4 must be exactly `SITE/api/auth/callback/google`. |
| Google says the app is blocked or access denied | Add the account as a test user (step 4). |
| Drafts stay "Drafting…" | The worker isn't running or has the wrong `DATABASE_URL`; check Render's logs. |
| PDFs never become ready | The worker has less than 1 GB of memory, or the S3 key can't write to the bucket. |

# Deploying Pathfinder on AWS Lightsail

Pathfinder runs as one always-on server: the app, its PostgreSQL database and Caddy (which handles
HTTPS) on a single Lightsail instance, started with Docker. Background work, the nightly timers,
PDF printing and saved files all work as they do on your computer.

**Cost:** about USD 12 a month for the instance (2 GB memory). The static IP is free while it's
attached. Automatic snapshots, if you turn them on, cost a little extra.

**Time:** about 45 minutes, most of it waiting for the first build.

You'll need:

- The code on GitHub, in a public repository (the AGPL licence asks for the source to be public
  anyway). For example, your fork of AienTech/dossier with the `pathfinder-multiuser` branch.
- An AWS account.
- Optional: a domain name you control. Without one, you can use a free `sslip.io` name (step 4).

## 1. Create the instance

1. Open the [Lightsail console](https://lightsail.aws.amazon.com/) and choose **Create instance**.
2. **Region:** the one your account allows. Pathfinder's server is in Sydney (ap-southeast-2): this AWS account is fixed to it. If yours offers Mumbai (ap-south-1) and your students are in India, that one is closer.
3. **Platform:** Linux/Unix. **Blueprint:** *OS Only* → **Ubuntu 24.04 LTS**.
4. **Plan:** the one with **2 GB** of memory. Smaller plans can't run the app and its PDF
   printer together.
5. **Name:** `pathfinder`. Choose **Create instance**.

## 2. Give it a fixed address

1. Open the instance → **Networking**.
2. Under **IPv4**, choose **Attach static IP** → **Create static IP**, then attach it.
3. Note the address, for example `13.233.10.20`.

## 3. Open the HTTPS port

On the same **Networking** tab, under **IPv4 Firewall**, choose **Add rule**: application
**HTTPS**, port **443**. SSH (22) and HTTP (80) are open already. Keep HTTP open: Caddy uses it
to get the certificate and to send visitors on to HTTPS.

## 4. Choose the address students will use

- **With your own domain:** at your domain provider, add an **A record**, for example
  `pathfinder.yourdomain.com`, pointing to the static IP. It can take a few minutes to work.
  Also point `www.` at the server (another A record to the same IP, or a CNAME to the domain):
  the site sends `www.` on to the main address. Remove any older records for the same names,
  such as a parking page or another host.
- **Without a domain:** use the static IP with dashes, followed by `.sslip.io`. For example,
  `13-233-10-20.sslip.io` already points to `13.233.10.20`; there's nothing to set up.

## 5. Install Pathfinder

1. On the instance's page, choose **Connect using SSH**. A terminal opens in your browser.
2. Download the setup script from your repository, replacing `<you>/<repo>` with your own:

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/<you>/<repo>/pathfinder-multiuser/deploy/lightsail/setup.sh
   ```

3. Run it with your repository's address and the address from step 4:

   ```bash
   sudo bash setup.sh https://github.com/<you>/<repo>.git pathfinder.yourdomain.com
   ```

The first run takes 15–25 minutes, mostly building the app. It ends with
`Pathfinder is up: https://…`. If it says the site isn't answering, see *Troubleshooting* below.

## 6. Sign in for the first time

Until sign-in is set up (step 7), the server is in **trial mode**: anyone with the access code can
sign in, under any email.

1. Show the access code: `sudo cat /root/pathfinder-access-code.txt`
2. Open your address in a browser, and sign in with your email and that code.

Don't give the access code to students: set up sign-in first (step 7).

## 7. Turn on sign-in with Firebase (recommended)

Students then create an account with their email and a password, or continue with Google. Firebase
sends the verification and password reset emails. It's free up to 50,000 monthly users.

1. In the [Firebase console](https://console.firebase.google.com/), create a project (or pick
   one). Google Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method:** enable **Email/Password** (not the
   passwordless email link) and **Google** (choose a support email).
3. **Authentication → Settings → Authorized domains:** add your address, e.g.
   `pathfinder.yourdomain.com` (or `52-64-48-163.sslip.io`).
4. **Project settings (gear icon) → General → Your apps:** add a **Web app** (no hosting needed).
   From the config it shows, copy `apiKey`, `authDomain` and `projectId`. None of them is a
   secret.
5. On the server, put them in the settings file:

   ```bash
   sudo nano /opt/pathfinder/deploy/lightsail/.env
   ```

   ```bash
   PATHFINDER_FIREBASE_API_KEY=<apiKey>
   PATHFINDER_FIREBASE_AUTH_DOMAIN=<authDomain>
   PATHFINDER_FIREBASE_PROJECT_ID=<projectId>
   ```

   Save (Ctrl+O, Enter, Ctrl+X), then run the setup command from step 5 again. The sign-in page
   now offers **Continue with Google**, email and password, **Create a free account** and
   **Forgot your password?**, and the access code no longer works.
6. Optional: **Authentication → Templates** lets you change the sender name and wording of the
   verification and reset emails.

A student who signed in before with the access code or Google keeps their account: the first
Firebase sign-in with the same verified email address links to it.

## 7b. Or: Google sign-in without Firebase

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or pick one).
2. **APIs & Services → OAuth consent screen:** user type **External**; fill in the app name,
   support email and developer email; save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**.
   - **Authorized redirect URIs:** add both of these (with your address):
     - `https://pathfinder.yourdomain.com/api/auth/google/callback` (signing in)
     - `https://pathfinder.yourdomain.com/api/google/callback` (Gmail and Calendar, which
       students can turn on later in Settings)
   - Create, then copy the **Client ID** and **Client secret**.
4. Back on the consent screen, choose **Publish app**. While it's in *Testing*, only test users
   you list can sign in. Signing in only asks for name and email address, so Google doesn't need
   to review it.
5. On the server, put both values in the settings file:

   ```bash
   sudo nano /opt/pathfinder/deploy/lightsail/.env
   ```

   Fill in `DOSSIER_GOOGLE_CLIENT_ID=` and `DOSSIER_GOOGLE_CLIENT_SECRET=`, then save
   (Ctrl+O, Enter, Ctrl+X).
6. Apply it by running the setup command from step 5 again. From now on the sign-in page shows
   **Continue with Google** only, and the access code no longer works. (With Firebase set up too,
   Firebase is used; set `PATHFINDER_SIGN_IN=google` to use this instead.)

If Google refuses an `sslip.io` redirect address, use your own domain instead (step 4).

## 8. AI provider

Pathfinder's server provides Claude for every student, so they only upload and read. Students
can still add their own key in **Settings → AI provider**, which isn't limited.

1. In the [Claude Console](https://console.anthropic.com/), create an API key and add billing.
   Keep the key private.
2. Add these lines to the settings file (`sudo nano /opt/pathfinder/deploy/lightsail/.env`):

   ```bash
   DOSSIER_AI_PROVIDER=anthropic
   DOSSIER_AI_MODEL=claude-opus-5-5
   DOSSIER_AI_KEY=<your key>
   PATHFINDER_AI_DAILY_LIMIT=10
   ```

   `PATHFINDER_AI_DAILY_LIMIT` counts AI requests per student per day (one resume analysis uses 2,
   so 10 allows 5 analyses); it resets at midnight
   IST. Leave it out for no limit.
3. Run the setup command from step 5 again to apply it.

On this key, reading a resume into fields runs on `claude-sonnet-5-5` and the review on
`DOSSIER_AI_MODEL`. When a model is overloaded or limiting requests, the call is tried once more
on `claude-sonnet-5-5`. Change either with `PATHFINDER_AI_READING_MODEL` and
`PATHFINDER_AI_FALLBACK_MODEL` (`off` for no backup). On another provider, such as Gemini through its
OpenAI-compatible address, every task runs on `DOSSIER_AI_MODEL` and there's no backup unless you
name one of that provider's models, e.g. `PATHFINDER_AI_FALLBACK_MODEL=gemini-3.5-flash-lite`: a
busy request is then tried once more on it. Every call on the server's key is logged in
the `AiCall` table with its model, tokens and cost (from list prices), never the prompt or answer.
To see what the AI cost today:

```bash
cd /opt/pathfinder/deploy/lightsail && sudo docker compose exec -T db psql -U pathfinder pathfinder -c "select model, count(*), sum(\"costMicroUsd\")/1e6 as usd from \"AiCall\" where \"createdAt\" > now() - interval '1 day' group by model"
```

### Students' own keys

Without the lines above, each student has to choose a provider and enter their own key in
**Settings → AI provider** before anything that uses AI works.

## The admin console

**Admin** in the sidebar (`/admin`) shows how many students there are, how many analyses they
run, the AI calls on the server's key with their tokens and cost by model, the latest feedback,
and each student's free allowance. It shows counts only, never a resume or an analysis.

It's for the email addresses in `PATHFINDER_ADMIN_EMAILS`. Add yours to `.env` (several are
separated by commas), then run the setup command from step 5 again:

```bash
echo 'PATHFINDER_ADMIN_EMAILS=you@example.com' | sudo tee -a /opt/pathfinder/deploy/lightsail/.env
```

Sign in with that address and **Admin** appears in the sidebar; for everyone else the page
doesn't exist. To give one student more free analyses a day, fewer, or 0, type the number in
their row and press **Save**; **Default** puts them back on `PATHFINDER_AI_DAILY_LIMIT`. It applies
at once. Costs come from list prices for Claude; for other models (e.g. Gemini) the console shows
the tokens and leaves the cost out.

## Reading testers' feedback

Testers use **Send feedback** in the sidebar. To read the latest 50, newest first, with who sent
each and from which page:

```bash
cd /opt/pathfinder/deploy/lightsail
sudo docker compose exec db psql -U pathfinder -d pathfinder -c 'SELECT f."createdAt", u.email, f.page, f.message FROM "Feedback" f JOIN "User" u ON u.id = f."userId" ORDER BY f."createdAt" DESC LIMIT 50;'
```

## Updating

After new code is pushed to the branch, run the setup command from step 5 again. It pulls the
code, rebuilds, and restarts the app, keeping the data and settings.

## Backups

- **Database:** every night at 03:30 a copy goes to `/var/backups/pathfinder`, kept for 14 days.
  These copies are on the same server, so they don't protect against losing it.
- **The whole server:** in Lightsail, open the instance → **Snapshots** → turn on **automatic
  snapshots**. That's the backup to rely on.

## Troubleshooting

All commands run on the server, from the deploy folder:

```bash
cd /opt/pathfinder/deploy/lightsail
```

- **Status of the parts** (the app, its worker, the database and Caddy): `sudo docker compose ps`
- **The app's recent log:** `sudo docker compose logs --tail 50 app`
- **The worker's recent log** (resume analyses, documents and other background jobs):
  `sudo docker compose logs --tail 50 worker`
- **Jobs waiting or running:** `sudo docker compose exec -T db psql -U pathfinder pathfinder -c 'select status, count(*) from "Job" group by status'`
- **No HTTPS certificate yet:** `sudo docker compose logs --tail 50 caddy`. Usually the domain
  doesn't point to the static IP yet, or port 443 or 80 isn't open (steps 3 and 4). Fix it, then
  `sudo docker compose restart caddy`.
- **Restart everything:** `sudo docker compose restart`

The settings file `/opt/pathfinder/deploy/lightsail/.env` holds the database password and the
app's secret key. Keep it private, and never commit it.

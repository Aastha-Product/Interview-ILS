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
2. **Region:** Mumbai (ap-south-1), close to your students.
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

Until Google sign-in is set up, the server is in **trial mode**: anyone with the access code can
sign in, under any email.

1. Show the access code: `sudo cat /root/pathfinder-access-code.txt`
2. Open your address in a browser, and sign in with your email and that code.

Don't give the access code to students: set up Google sign-in first (step 7).

## 7. Turn on Google sign-in

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
   **Continue with Google** only, and the access code no longer works.

If Google refuses an `sslip.io` redirect address, use your own domain instead (step 4).

## 8. AI provider

Each student chooses an AI provider and enters their own key in **Settings → AI provider**. To
give everyone a default, add `DOSSIER_AI_PROVIDER`, `DOSSIER_AI_URL`, `DOSSIER_AI_MODEL` and
`DOSSIER_AI_KEY` to the `.env` file (see `.env.example`) and run setup again.

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

- **Status of the three parts:** `sudo docker compose ps`
- **The app's recent log:** `sudo docker compose logs --tail 50 app`
- **No HTTPS certificate yet:** `sudo docker compose logs --tail 50 caddy`. Usually the domain
  doesn't point to the static IP yet, or port 443 or 80 isn't open (steps 3 and 4). Fix it, then
  `sudo docker compose restart caddy`.
- **Restart everything:** `sudo docker compose restart`

The settings file `/opt/pathfinder/deploy/lightsail/.env` holds the database password and the
app's secret key. Keep it private, and never commit it.

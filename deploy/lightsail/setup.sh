#!/usr/bin/env bash
# Sets Pathfinder up on a fresh Ubuntu 24.04 server (AWS Lightsail), or brings an existing setup
# up to date. Run it as root, with your repository's address and the server's domain name:
#
#   sudo bash setup.sh https://github.com/<you>/<repo>.git pathfinder.example.com
#
# It installs Docker, adds swap (building needs more memory than a 2 GB server has), checks out
# the code in /opt/pathfinder, makes the secrets once (deploy/lightsail/.env), builds the app and
# starts it with its database and HTTPS. Safe to run again: it keeps the .env and the data.
# See docs/deploy-aws-lightsail.md.
set -euo pipefail

REPO_URL=${1:?Usage: sudo bash setup.sh <repository URL> <domain name>}
DOMAIN=${2:?Usage: sudo bash setup.sh <repository URL> <domain name>}
BRANCH=${BRANCH:-pathfinder-multiuser}
DIR=/opt/pathfinder
DEPLOY="$DIR/deploy/lightsail"
SECRETS_NOTE=/root/pathfinder-access-code.txt

say() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo bash setup.sh $REPO_URL $DOMAIN" >&2
  exit 1
fi

say "Swap space"
# 4 GB: building the app's type check needs about 3 GB of memory, more than the server has.
SWAP_BYTES=$((4 * 1024 * 1024 * 1024))
current=$(stat -c %s /swapfile 2>/dev/null || echo 0)
if [ "$current" -lt "$SWAP_BYTES" ]; then
  swapoff /swapfile 2>/dev/null || true
  rm -f /swapfile
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Swap is now 4 GB."
else
  swapon /swapfile 2>/dev/null || true
  echo "Already there."
fi

say "Docker and git"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates git openssl curl docker.io docker-compose-v2 docker-buildx >/dev/null
systemctl enable --now docker >/dev/null

say "The code ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" pull --quiet --ff-only origin "$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$DIR"
fi
git -C "$DIR" log -1 --format='Now at %h: %s'

cd "$DEPLOY"
rerun=false
[ -f .env ] && rerun=true
if [ ! -f .env ]; then
  say "Secrets (made once, kept in $DEPLOY/.env)"
  umask 077
  cat > .env <<EOF
PATHFINDER_DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
DOSSIER_SECRET=$(openssl rand -hex 32)
TZ=Asia/Kolkata
# Google sign-in: fill these in from Google Cloud Console, then run setup.sh again.
DOSSIER_GOOGLE_CLIENT_ID=
DOSSIER_GOOGLE_CLIENT_SECRET=
EOF
  echo "Written."
else
  # The domain may have changed since the first run.
  sed -i "s|^PATHFINDER_DOMAIN=.*|PATHFINDER_DOMAIN=$DOMAIN|" .env
fi

say "Building the app (10-20 minutes the first time)"
# Plain docker build: compose would refuse to run before the access code's hash is in .env.
DOCKER_BUILDKIT=1 docker build --target production --tag pathfinder-app:local "$DIR"

if ! grep -q '^DOSSIER_PASSWORD=' .env; then
  say "The access code (sign-in until Google is set up)"
  code=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  hash=$(printf '%s\n' "$code" | docker run --rm -i pathfinder-app:local hash-password 2>/dev/null)
  printf 'DOSSIER_PASSWORD=%s\n' "$hash" >> .env
  umask 077
  printf 'Pathfinder access code: %s\n' "$code" > "$SECRETS_NOTE"
  echo "Made one; it's in $SECRETS_NOTE (readable by root only)."
fi

say "Starting"
docker compose up -d --remove-orphans
# On a re-run, the app picks up the new build and any change to .env.
if [ "$rerun" = true ]; then docker compose up -d --no-deps --force-recreate app; fi
docker image prune -f >/dev/null

say "Nightly database backup (03:30, kept for 14 days, in /var/backups/pathfinder)"
mkdir -p /var/backups/pathfinder
chmod 700 /var/backups/pathfinder
cat > /etc/cron.d/pathfinder-backup <<EOF
30 3 * * * root cd $DEPLOY && docker compose exec -T db pg_dump -U pathfinder pathfinder | gzip > /var/backups/pathfinder/pathfinder-\$(date +\%F).sql.gz && find /var/backups/pathfinder -name '*.sql.gz' -mtime +14 -delete
EOF
echo "Scheduled."

say "Waiting for https://$DOMAIN"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    echo "Pathfinder is up: https://$DOMAIN"
    grep -q '^DOSSIER_GOOGLE_CLIENT_ID=.\+' .env \
      && echo "Students sign in with Google." \
      || echo "Until Google is set up, sign in with any email and the access code: sudo cat $SECRETS_NOTE"
    exit 0
  fi
  sleep 5
done
echo "It isn't answering on https://$DOMAIN yet. Check that the domain points at this server and ports 80 and 443 are open, then look at: cd $DEPLOY && docker compose logs --tail 50" >&2
exit 1

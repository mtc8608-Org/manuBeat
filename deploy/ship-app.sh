#!/bin/bash
# STAGE 3 — build this app's production artifacts on the laptop and ship
# them to the box (images are built off-box by design: the server carries
# no build tooling). Requires provision.sh (edge network, /srv/caddy) and
# ship-caddy.sh (front door live) to have run there first.
#
# Idempotent: re-runs rebuild and re-ship everything; the on-box .env is
# created once and never touched again; volumes are never touched.
#
# Usage: ./deploy/ship-app.sh <user@host>     (or set DEPLOY_HOST)
# The host is never hardcoded — the repo is public, the box is not.
set -euo pipefail

# ============================================================================
# STEP 0 — Resolve the target host and the app name
# ============================================================================
# Positional arg wins, DEPLOY_HOST env var is the fallback; abort with usage
# if neither is set. The app name comes from the local .env's
# COMPOSE_PROJECT_NAME — forks inherit this script unmodified and can never
# ship under the wrong name.
host="${1:-${DEPLOY_HOST:-}}"
[ -n "$host" ] || { echo "usage: $0 <user@host>   (or set DEPLOY_HOST)" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"

app="$(grep -E '^COMPOSE_PROJECT_NAME=' "$root/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '[:space:]')"
[ -n "$app" ] || { echo "COMPOSE_PROJECT_NAME not found in $root/.env" >&2; exit 1; }

appdir="/srv/apps/$app"

# ============================================================================
# STEP 1 — Build the production images locally
# ============================================================================
# Dockerfile.prod = slim base + baked source, no dev tooling (dev images
# bake no code at all — these are separate artifacts, not variants). Tags
# match what docker-compose.prod.yml references.
echo "== building ${app}_nodejs:prod and ${app}_python:prod"
docker build -t "${app}_nodejs:prod" -f "$root/nodejs/Dockerfile.prod" "$root/nodejs"
docker build -t "${app}_python:prod" -f "$root/python/Dockerfile.prod" "$root/python"

# ============================================================================
# STEP 2 — Build the static PWA in an ephemeral container
# ============================================================================
# No pwa container in prod: Caddy serves this build. The ephemeral node:20
# container pins the toolchain to the same line the dev image uses, so the
# build never depends on whatever node the laptop happens to have. Runs as
# the host user so dist/ isn't root-owned; HOME=/tmp gives npm a writable
# cache as that user.
echo "== building the PWA (tsc && vite build)"
docker run --rm -v "$root/pwa":/src -w /src \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  node:20 sh -c 'npm ci && npm run build'

# ============================================================================
# STEP 3 — Place the on-box app skeleton (code vs config policy)
# ============================================================================
# Code is always refreshed: the compose file (shipped under its on-box name
# docker-compose.yml), init-scripts/ (only consumed on an empty pg volume),
# and public/ (seed PNGs, mounted read-only into nodejs). Config is created
# once and never overwritten: .env starts as the template, gets filled by
# hand on the box (+ password manager), chmod 600. First ship stops here.
echo "== placing app skeleton in $appdir on $host"
ssh "$host" "mkdir -p $appdir"
rsync -az "$root/docker-compose.prod.yml" "$host:$appdir/docker-compose.yml"
rsync -az --delete "$root/init-scripts/" "$host:$appdir/init-scripts/"
rsync -az --delete "$root/pwa/public/"  "$host:$appdir/public/"

if ! ssh "$host" "test -f $appdir/.env"; then
  rsync -az "$root/.env.prod.example" "$host:$appdir/.env"
  ssh "$host" "chmod 600 $appdir/.env"
  cat <<EOF

Created $appdir/.env from the template — fill it on the box now
(generated values per the openssl one-liners in its comments, admin login
of your choosing; keep copies in the password manager):
  ssh $host
  vi $appdir/.env
Then re-run this script to ship.
EOF
  exit 0
fi

# ============================================================================
# STEP 4 — Preflight: refuse to ship against an unfilled .env
# ============================================================================
# A half-filled .env would crash-loop the backend (SECRETS_MASTER_KEY has a
# strict 64-hex format) or seed an admin with an empty password — so verify
# every secret is present before anything lands on the box.
echo "== checking $appdir/.env on $host"
for key in POSTGRES_PASSWORD JWT_SECRET ADMIN_EMAIL ADMIN_PASSWORD MINIO_PASSWORD; do
  if ! ssh "$host" "grep -Eq '^$key=.+' $appdir/.env"; then
    echo "$appdir/.env is missing $key — fill it on the box, then re-run." >&2
    exit 1
  fi
done
if ! ssh "$host" "grep -Eq '^SECRETS_MASTER_KEY=[0-9a-f]{64}\$' $appdir/.env"; then
  echo "$appdir/.env: SECRETS_MASTER_KEY must be exactly 64 hex chars (openssl rand -hex 32)." >&2
  exit 1
fi

# ============================================================================
# STEP 5 — Ship the images
# ============================================================================
# No registry involved: stream the tarballs over the existing ssh channel,
# gzipped. docker load makes them available under the tags the compose file
# references. postgres/minio are stock images — the box pulls those itself.
echo "== shipping images (docker save | ssh docker load)"
docker save "${app}_nodejs:prod" "${app}_python:prod" | gzip | ssh "$host" 'gunzip | docker load'

# ============================================================================
# STEP 6 — Ship the static PWA build
# ============================================================================
# Caddy's compose mounts /srv/caddy/www at /srv/www read-only, so the new
# subtree is live immediately — no Caddy restart. --delete prunes stale
# content-hashed bundles from previous ships.
echo "== shipping PWA build to /srv/caddy/www/$app"
rsync -az --delete "$root/pwa/dist/" "$host:/srv/caddy/www/$app/"

# ============================================================================
# STEP 7 — Start / refresh the stack
# ============================================================================
# With -f, the project directory is the compose file's directory, so the
# relative mounts and env_file resolve against $appdir. First run creates
# everything (postgres runs init-scripts on the fresh volume); later runs
# recreate only what changed. Volumes are never touched.
echo "== starting the $app stack"
ssh "$host" "docker compose -f $appdir/docker-compose.yml up -d"

cat <<EOF

$app stack is up. If this app has no block in /srv/caddy/Caddyfile yet,
add one on the box (adapt the commented example in Caddyfile.template:
proxy /api/* and /graphql to ${app}_nodejs:3000, file_server from
/srv/www/$app) and reload:
  ssh $host 'docker exec platform-caddy-1 caddy reload --config /etc/caddy/Caddyfile'

Self-tests from the laptop (<sub> = the subdomain you mapped):
  curl -I  https://<sub>.cabeleira.net             # 200, index.html via Caddy
  curl -si https://<sub>.cabeleira.net/api/me      # 401 JSON — backend alive
  ssh $host 'docker logs ${app}_nodejs --tail 30'  # admin + image seed clean
EOF

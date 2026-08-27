#!/bin/bash
# STAGE 2 — build the Caddy platform image on the laptop and ship it to the
# box (images are built off-box by design: the server carries no build
# tooling). Requires provision.sh to have run there first.
#
# Usage: ./deploy/ship-caddy.sh <user@host>     (or set DEPLOY_HOST)
# The host is never hardcoded — the repo is public, the box is not.
set -euo pipefail

# ============================================================================
# STEP 0 — Resolve the target host
# ============================================================================
# Positional arg wins, DEPLOY_HOST env var is the fallback; abort with usage
# if neither is set.
host="${1:-${DEPLOY_HOST:-}}"
[ -n "$host" ] || { echo "usage: $0 <user@host>   (or set DEPLOY_HOST)" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"

# ============================================================================
# STEP 1 — Build the image locally
# ============================================================================
# caddy/Dockerfile = stock Caddy + the caddy-dns/hetzner/v2 module (needed
# for the wildcard cert's DNS-01 challenge). Built here, never on the box.
echo "== building manu-caddy:2 (xcaddy + caddy-dns/hetzner)"
docker build -t manu-caddy:2 "$here/caddy"

# ============================================================================
# STEP 2 — Preflight: the box must be ready to run it
# ============================================================================
# Caddy without a Hetzner token would start, fail DNS-01, and burn Let's
# Encrypt rate limits on retries — so refuse to ship until /srv/caddy/.env
# (created by provision.sh, filled by hand) has a non-empty token.
echo "== checking /srv/caddy/.env on $host"
if ! ssh "$host" "grep -Eq '^HETZNER_API_TOKEN=.+' /srv/caddy/.env"; then
  cat >&2 <<EOF
/srv/caddy/.env is missing HETZNER_API_TOKEN — fill it on the box first:
  HETZNER_API_TOKEN  dns.hetzner.com → Manage API tokens
  ACME_EMAIL         Let's Encrypt account email
Then re-run this script.
EOF
  exit 1
fi

# ============================================================================
# STEP 3 — Ship the image
# ============================================================================
# No registry involved: stream the tarball over the existing ssh channel,
# gzipped (image layers compress well). docker load makes it available
# under the same tag the compose file references.
echo "== shipping image (docker save | ssh docker load)"
docker save manu-caddy:2 | gzip | ssh "$host" 'gunzip | docker load'

# ============================================================================
# STEP 4 — (Re)start Caddy on the box
# ============================================================================
# compose up -d against the file provision.sh installed: first run creates
# the container, later runs recreate it only if the image or config changed.
# Cert state lives in the caddy_data volume, so recreates don't re-issue.
echo "== starting caddy"
ssh "$host" 'docker compose -f /srv/caddy/docker-compose.yml up -d'

cat <<EOF

Caddy is up. Self-tests from the laptop:
  curl -I https://anything.cabeleira.net      # valid wildcard TLS + 404
  ssh $host 'docker logs platform-caddy-1 --tail 50'
EOF

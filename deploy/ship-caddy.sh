#!/bin/bash
# STAGE 2 — build the Caddy platform image on the laptop and ship it to the
# box (images are built off-box by design: the server carries no build
# tooling). Requires provision.sh to have run there first.
#
# Usage: ./deploy/ship-caddy.sh <user@host>     (or set DEPLOY_HOST)
# The host is never hardcoded — the repo is public, the box is not.
set -euo pipefail

host="${1:-${DEPLOY_HOST:-}}"
[ -n "$host" ] || { echo "usage: $0 <user@host>   (or set DEPLOY_HOST)" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"

echo "== building manu-caddy:2 (xcaddy + caddy-dns/hetzner)"
docker build -t manu-caddy:2 "$here/caddy"

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

echo "== shipping image (docker save | ssh docker load)"
docker save manu-caddy:2 | gzip | ssh "$host" 'gunzip | docker load'

echo "== starting caddy"
ssh "$host" 'docker compose -f /srv/caddy/docker-compose.yml up -d'

cat <<EOF

Caddy is up. Self-tests from the laptop:
  curl -I https://anything.cabeleira.net      # valid wildcard TLS + 404
  ssh $host 'docker logs platform-caddy-1 --tail 50'
EOF

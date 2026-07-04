#!/bin/bash
# STAGE 1 — provision a fresh Ubuntu box into the ManuLab platform layer:
# docker, log rotation, SSH hardening, unattended-upgrades, swap, the
# external `edge` network, and the /srv/caddy skeleton.
#
# Idempotent: every step probes real system state and no-ops when satisfied —
# safe to re-run after a partial failure or on a live box.
#
# Run from the laptop (needs its sibling caddy/ dir, so copy — don't pipe):
#   rsync -r deploy/ root@<box>:/root/deploy/
#   ssh root@<box> 'bash /root/deploy/provision.sh'
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

step() { echo; echo "== $1"; }
ok()   { echo "   ok: $1"; }

[ "$(id -u)" = 0 ] || { echo "must run as root" >&2; exit 1; }

step "docker (Ubuntu archive packages — security-patched by unattended-upgrades)"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  ok "docker + compose already installed"
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -yq docker.io docker-compose-v2
  ok "installed docker.io + docker-compose-v2"
fi
systemctl enable --now docker >/dev/null 2>&1
ok "docker enabled and running"

step "docker log rotation (json-file caps — logs can't fill the disk)"
daemon_json='{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}'
if [ -f /etc/docker/daemon.json ] && [ "$(cat /etc/docker/daemon.json)" = "$daemon_json" ]; then
  ok "daemon.json already in place"
else
  mkdir -p /etc/docker
  printf '%s\n' "$daemon_json" > /etc/docker/daemon.json
  systemctl restart docker
  ok "daemon.json written, docker restarted"
fi

step "ssh hardening (key-only; drop-in, validated before reload)"
sshd_conf=/etc/ssh/sshd_config.d/90-hardening.conf
sshd_content='PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
X11Forwarding no'
if [ -f "$sshd_conf" ] && [ "$(cat "$sshd_conf")" = "$sshd_content" ]; then
  ok "drop-in already in place"
else
  printf '%s\n' "$sshd_content" > "$sshd_conf"
  sshd -t                    # set -e aborts here rather than reload a broken config
  systemctl reload ssh       # reload, not restart — never drops the live session
  ok "drop-in written, sshd reloaded"
fi

step "unattended-upgrades (security pocket; auto-reboot 04:30)"
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -yq unattended-upgrades
fi
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52-manu-autoreboot <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
ok "enabled (containers are restart:unless-stopped — the stack survives reboots)"

step "2G swapfile (OOM insurance; swappiness 10)"
if swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  ok "swapfile already active"
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "created and activated"
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-swappiness.conf
sysctl -q -p /etc/sysctl.d/90-swappiness.conf
ok "swappiness=10"

step "external docker network: edge"
if docker network inspect edge >/dev/null 2>&1; then
  ok "already exists"
else
  docker network create edge >/dev/null
  ok "created"
fi

step "/srv/caddy platform skeleton"
mkdir -p /srv/caddy/www
install -m 644 "$here/caddy/docker-compose.yml" /srv/caddy/docker-compose.yml
ok "docker-compose.yml refreshed (code — always overwritten)"
if [ -f /srv/caddy/Caddyfile ]; then
  ok "Caddyfile exists — left untouched (holds the real hostname map)"
else
  install -m 644 "$here/caddy/Caddyfile.template" /srv/caddy/Caddyfile
  ok "Caddyfile created from template"
fi
if [ -f /srv/caddy/.env ]; then
  ok ".env exists — left untouched (holds the real token)"
else
  install -m 600 "$here/caddy/.env.example" /srv/caddy/.env
  ok ".env skeleton created (chmod 600)"
fi

echo
echo "=========================================="
echo "  PROVISIONED — next steps"
echo "=========================================="
cat <<'EOF'
1. Fill /srv/caddy/.env  (HETZNER_API_TOKEN from dns.hetzner.com, ACME_EMAIL)
2. Edit /srv/caddy/Caddyfile — real hostname→app map (stays on-box only)
3. From the laptop:  ./deploy/ship-caddy.sh root@<box>
EOF

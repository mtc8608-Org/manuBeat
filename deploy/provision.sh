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

# Resolve the directory this script lives in, so the caddy/ files it installs
# are found relative to itself no matter where it is invoked from.
here="$(cd "$(dirname "$0")" && pwd)"

step() { echo; echo "== $1"; }
ok()   { echo "   ok: $1"; }

# Everything below writes to /etc, /srv and systemd — root is non-negotiable.
[ "$(id -u)" = 0 ] || { echo "must run as root" >&2; exit 1; }

# ============================================================================
# STEP 1 — Docker engine + compose plugin
# ============================================================================
# Ubuntu archive packages (docker.io, docker-compose-v2) instead of Docker's
# upstream repo: the archive pocket is covered by unattended-upgrades (step 4),
# so the engine gets security patches without adding a third-party apt source.
step "docker (Ubuntu archive packages — security-patched by unattended-upgrades)"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  # Probe both halves: the engine binary AND the compose v2 plugin.
  ok "docker + compose already installed"
else
  export DEBIAN_FRONTEND=noninteractive   # no debconf prompts over ssh
  apt-get update -q
  apt-get install -yq docker.io docker-compose-v2
  ok "installed docker.io + docker-compose-v2"
fi
# enable --now is idempotent: starts the daemon and registers it for boot.
systemctl enable --now docker >/dev/null 2>&1
ok "docker enabled and running"

# ============================================================================
# STEP 2 — Docker log rotation
# ============================================================================
# Default json-file logging is unbounded; a chatty container can fill the
# disk. Cap every container at 3 × 10 MB rotated files (~30 MB worst case).
step "docker log rotation (json-file caps — logs can't fill the disk)"
daemon_json='{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}'
if [ -f /etc/docker/daemon.json ] && [ "$(cat /etc/docker/daemon.json)" = "$daemon_json" ]; then
  # Byte-exact comparison — any drift (manual edits included) rewrites it.
  ok "daemon.json already in place"
else
  mkdir -p /etc/docker
  printf '%s\n' "$daemon_json" > /etc/docker/daemon.json
  systemctl restart docker    # daemon.json is only read at daemon start
  ok "daemon.json written, docker restarted"
fi

# ============================================================================
# STEP 3 — SSH hardening
# ============================================================================
# Key-only access via a drop-in under sshd_config.d/ — never touches the
# distro's main sshd_config, so OS upgrades merge cleanly.
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

# ============================================================================
# STEP 4 — Unattended security upgrades
# ============================================================================
# Daily apt update + install from the security pocket, with an automatic
# reboot at 04:30 when a patch (kernel, libc) requires one. Safe because
# every container runs restart:unless-stopped — the stack comes back on boot.
step "unattended-upgrades (security pocket; auto-reboot 04:30)"
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -yq unattended-upgrades
fi
# 20auto-upgrades turns the periodic runs on; 52-manu-autoreboot layers the
# reboot policy on top (numbered after the package's own 50unattended-upgrades
# so it wins). Both are plain overwrites — always safe to reapply.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52-manu-autoreboot <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
ok "enabled (containers are restart:unless-stopped — the stack survives reboots)"

# ============================================================================
# STEP 5 — Swap
# ============================================================================
# 2G swapfile as OOM insurance on a small box. swappiness=10 keeps it as a
# last resort — the kernel only swaps under real memory pressure.
step "2G swapfile (OOM insurance; swappiness 10)"
if swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  ok "swapfile already active"
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile          # swap must not be world-readable
  mkswap /swapfile >/dev/null
  swapon /swapfile
  # fstab entry so it survives reboot; grep guards against duplicates.
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "created and activated"
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-swappiness.conf
sysctl -q -p /etc/sysctl.d/90-swappiness.conf   # apply now, persists via the file
ok "swappiness=10"

# ============================================================================
# STEP 6 — Shared `edge` network
# ============================================================================
# One external docker network joining Caddy to every app stack. External so
# no single compose project owns it — app stacks come and go, the network
# stays.
step "external docker network: edge"
if docker network inspect edge >/dev/null 2>&1; then
  ok "already exists"
else
  docker network create edge >/dev/null
  ok "created"
fi

# ============================================================================
# STEP 7 — /srv/caddy platform skeleton
# ============================================================================
# Three files, two policies:
#   code   (docker-compose.yml)  — always overwritten; the repo is the truth
#   config (Caddyfile, .env)     — created once, then never touched; the box
#                                  is the truth (real hostname map + secrets
#                                  deliberately never enter the public repo)
step "/srv/caddy platform skeleton"
mkdir -p /srv/caddy/www        # static PWA builds get shipped under www/<app>
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
  install -m 600 "$here/caddy/.env.example" /srv/caddy/.env   # 600: will hold the API token
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

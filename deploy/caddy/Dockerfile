# Stock Caddy lacks the Hetzner DNS-01 module needed for the wildcard cert.
# Built on the laptop and shipped via ship-caddy.sh — never built on the box.
# /v2 is required: v1 targets the old dns.hetzner.com API, retired May 2026;
# v2 targets the Cloud DNS API (zones in console.hetzner.com).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/hetzner/v2

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

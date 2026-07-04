# Stock Caddy lacks the Hetzner DNS-01 module needed for the wildcard cert.
# Built on the laptop and shipped via ship-caddy.sh — never built on the box.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/hetzner

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

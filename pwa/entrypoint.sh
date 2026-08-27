#!/bin/bash
# npm ci installs exactly the lockfile, never writes it (updates happen
# laptop-side only) — but it also wipes node_modules first, so skip it when
# the installed tree already matches the lockfile. The marker is our own
# copy, written only after a *completed* npm ci (npm's own hidden
# node_modules/.package-lock.json is a different format — not comparable).
# Recovery from a corrupted tree with a current marker: rm -rf node_modules.
marker=node_modules/.installed-package-lock.json
if [ -f "$marker" ] && cmp -s package-lock.json "$marker"; then
  echo "Dependencies up to date - skipping install."
else
  echo "Installing dependencies..."
  npm ci
  cp package-lock.json "$marker"
  echo "Done."
fi
echo "Starting ionic $@..."
exec ionic "$@"

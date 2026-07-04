#!/bin/bash
echo "Installing dependencies..."
# npm ci: installs exactly the lockfile, never writes it.
# Lockfile updates happen laptop-side only.
npm ci
echo "Done."
echo "Starting ionic $@..."
exec ionic "$@"

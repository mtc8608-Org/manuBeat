#!/bin/bash
echo "Installing dependencies..."
# npm ci: removes node_modules itself, installs exactly the lockfile,
# never writes it. Lockfile updates happen laptop-side only.
npm ci
echo "Done."
echo "Starting $@..."
exec node_modules/.bin/nodemon $@.js

